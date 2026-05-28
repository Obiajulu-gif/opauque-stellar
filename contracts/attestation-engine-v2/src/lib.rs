#![no_std]
use sha2::{Digest, Sha256};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN,
    Env, IntoVal, Symbol,
};

#[contract]
pub struct AttestationEngineV2;

#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    pub uid: BytesN<32>,
    pub schema_id: BytesN<32>,
    pub issuer: Address,
    pub stealth_address_hash: BytesN<32>,
    pub data: Bytes,
    pub created_at: u32,
    pub expiration_ledger: u32,
    pub revocation_ledger: u32,
    pub ref_uid: BytesN<32>,
    pub issuance_sequence: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AttestationError {
    DataTooLarge = 1,
    UnauthorizedIssuer = 2,
    ExpirationInPast = 3,
    AttestationNotFound = 4,
    AlreadyRevoked = 5,
    NotRevocable = 6,
    Unauthorized = 7,
    AttestationAlreadyExists = 8,
}

fn attestation_key(uid: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(&uid.env(), "attest"), uid.clone())
}

fn issuance_sequence_key(
    schema_id: &BytesN<32>,
    stealth_hash: &BytesN<32>,
) -> (Symbol, BytesN<32>, BytesN<32>) {
    (
        Symbol::new(&schema_id.env(), "attseq"),
        schema_id.clone(),
        stealth_hash.clone(),
    )
}

fn compute_attestation_uid(
    env: &Env,
    schema_id: &BytesN<32>,
    stealth_hash: &BytesN<32>,
    ledger: u32,
    issuance_sequence: u64,
) -> BytesN<32> {
    // Deterministic UID preimage:
    // schema_id || stealth_address_hash || ledger_sequence || issuance_sequence.
    // The contract-managed sequence prevents same-ledger attestations for the
    // same schema and stealth hash from deriving the same storage key.
    let mut hasher = Sha256::new();
    hasher.update(schema_id.to_array());
    hasher.update(stealth_hash.to_array());
    hasher.update(ledger.to_be_bytes());
    hasher.update(issuance_sequence.to_be_bytes());
    BytesN::from_array(env, &hasher.finalize().into())
}

fn next_issuance_sequence(env: &Env, schema_id: &BytesN<32>, stealth_hash: &BytesN<32>) -> u64 {
    let key = issuance_sequence_key(schema_id, stealth_hash);
    let current: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    let next = current.saturating_add(1);
    env.storage().persistent().set(&key, &next);
    next
}

#[contractimpl]
impl AttestationEngineV2 {
    pub fn attest(
        env: Env,
        issuer: Address,
        schema_id: BytesN<32>,
        schema_registry: Address,
        stealth_address_hash: BytesN<32>,
        data: Bytes,
        expiration_ledger: u32,
        ref_uid: BytesN<32>,
    ) -> Result<BytesN<32>, AttestationError> {
        issuer.require_auth();
        if data.len() > 512 {
            return Err(AttestationError::DataTooLarge);
        }
        let ledger = env.ledger().sequence();
        if expiration_ledger != 0 && expiration_ledger <= ledger {
            return Err(AttestationError::ExpirationInPast);
        }
        let authorized: bool = env.invoke_contract(
            &schema_registry,
            &Symbol::new(&env, "is_authorized_issuer"),
            (schema_id.clone(), issuer.clone()).into_val(&env),
        );
        if !authorized {
            return Err(AttestationError::UnauthorizedIssuer);
        }
        let issuance_sequence = next_issuance_sequence(&env, &schema_id, &stealth_address_hash);
        let uid = compute_attestation_uid(
            &env,
            &schema_id,
            &stealth_address_hash,
            ledger,
            issuance_sequence,
        );
        let key = attestation_key(&uid);
        if env.storage().persistent().has(&key) {
            return Err(AttestationError::AttestationAlreadyExists);
        }
        let attestation = Attestation {
            uid: uid.clone(),
            schema_id: schema_id.clone(),
            issuer: issuer.clone(),
            stealth_address_hash: stealth_address_hash.clone(),
            data,
            created_at: ledger,
            expiration_ledger,
            revocation_ledger: 0,
            ref_uid,
            issuance_sequence,
        };
        env.storage().persistent().set(&key, &attestation);
        env.events().publish(
            (Symbol::new(&env, "AttestationCreated"),),
            (uid.clone(), schema_id, issuer, stealth_address_hash),
        );
        Ok(uid)
    }

    pub fn revoke_attestation(
        env: Env,
        revoker: Address,
        uid: BytesN<32>,
        schema_registry: Address,
    ) -> Result<(), AttestationError> {
        revoker.require_auth();
        let key = attestation_key(&uid);
        let mut attestation: Attestation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(AttestationError::AttestationNotFound)?;
        if attestation.revocation_ledger != 0 {
            return Err(AttestationError::AlreadyRevoked);
        }
        let revocable: bool = env.invoke_contract(
            &schema_registry,
            &Symbol::new(&env, "is_revocable"),
            (attestation.schema_id.clone(),).into_val(&env),
        );
        if !revocable {
            return Err(AttestationError::NotRevocable);
        }
        let authorized: bool = env.invoke_contract(
            &schema_registry,
            &Symbol::new(&env, "is_authorized_issuer"),
            (attestation.schema_id.clone(), revoker.clone()).into_val(&env),
        );
        if !authorized && revoker != attestation.issuer {
            return Err(AttestationError::Unauthorized);
        }
        attestation.revocation_ledger = env.ledger().sequence();
        env.storage().persistent().set(&key, &attestation);
        env.events().publish(
            (Symbol::new(&env, "AttestationRevoked"),),
            (uid, revoker),
        );
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    extern crate schema_registry;
    use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String as SorobanString};

    fn setup() -> (
        Env,
        Address,
        Address,
        schema_registry::SchemaRegistryClient<'static>,
        AttestationEngineV2Client<'static>,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let schema_contract_id = env.register_contract(None, schema_registry::SchemaRegistry);
        let schema_client =
            schema_registry::SchemaRegistryClient::new(&env, &schema_contract_id);

        let engine_contract_id = env.register_contract(None, AttestationEngineV2);
        let engine_client = AttestationEngineV2Client::new(&env, &engine_contract_id);

        let authority = Address::generate(&env);
        (env, authority, schema_contract_id, schema_client, engine_client)
    }

    fn register_schema(
        env: &Env,
        schema_client: &schema_registry::SchemaRegistryClient,
        authority: &Address,
        schema_id: &BytesN<32>,
        revocable: bool,
    ) {
        schema_client.register_schema(
            authority,
            schema_id,
            &SorobanString::from_str(env, "TestSchema"),
            &SorobanString::from_str(env, "field1:string"),
            &revocable,
            &1u32,
            &None,
            &0u32,
        );
    }

    #[test]
    fn test_attest_valid() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let issuer = authority.clone();

        register_schema(&env, &schema_client, &authority, &schema_id, true);

        let stealth_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
        let data = Bytes::from_array(&env, &[1u8, 2u8, 3u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let uid = engine_client.attest(
            &issuer,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );

        assert!(uid.to_array() != [0u8; 32]);
    }

    #[test]
    fn test_attest_unauthorized_issuer() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[2u8; 32]);

        register_schema(&env, &schema_client, &authority, &schema_id, true);

        let stranger = Address::generate(&env);
        let stealth_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let result = engine_client.try_attest(
            &stranger,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );
        assert_eq!(result, Err(Ok(AttestationError::UnauthorizedIssuer)));
    }

    #[test]
    fn test_attest_delegate_authorized() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[3u8; 32]);
        let delegate = Address::generate(&env);

        register_schema(&env, &schema_client, &authority, &schema_id, true);
        schema_client.add_delegate(&authority, &schema_id, &delegate);

        let stealth_hash = BytesN::from_array(&env, &[0xBBu8; 32]);
        let data = Bytes::from_array(&env, &[4u8, 5u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let uid = engine_client.attest(
            &delegate,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );
        assert!(uid.to_array() != [0u8; 32]);
    }

    #[test]
    fn test_attest_data_too_large() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[4u8; 32]);

        register_schema(&env, &schema_client, &authority, &schema_id, true);

        let stealth_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
        let big_data = Bytes::from_array(&env, &[0u8; 513]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let result = engine_client.try_attest(
            &authority,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &big_data,
            &0u32,
            &ref_uid,
        );
        assert_eq!(result, Err(Ok(AttestationError::DataTooLarge)));
    }

    #[test]
    fn test_revoke_attestation() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[5u8; 32]);

        register_schema(&env, &schema_client, &authority, &schema_id, true);

        let stealth_hash = BytesN::from_array(&env, &[0xCCu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let uid = engine_client.attest(
            &authority,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );

        engine_client.revoke_attestation(&authority, &uid, &schema_id_addr);
    }

    #[test]
    fn test_revoke_not_found() {
        let (env, authority, schema_id_addr, _schema_client, engine_client) = setup();
        let fake_uid = BytesN::from_array(&env, &[0xFFu8; 32]);
        let result = engine_client.try_revoke_attestation(&authority, &fake_uid, &schema_id_addr);
        assert_eq!(result, Err(Ok(AttestationError::AttestationNotFound)));
    }

    #[test]
    fn test_revoke_not_revocable_schema() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[7u8; 32]);

        register_schema(&env, &schema_client, &authority, &schema_id, false);

        let stealth_hash = BytesN::from_array(&env, &[0xEEu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let uid = engine_client.attest(
            &authority,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );

        let result = engine_client.try_revoke_attestation(&authority, &uid, &schema_id_addr);
        assert_eq!(result, Err(Ok(AttestationError::NotRevocable)));
    }

    #[test]
    fn test_revoke_by_delegate() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[8u8; 32]);
        let delegate = Address::generate(&env);

        register_schema(&env, &schema_client, &authority, &schema_id, true);
        schema_client.add_delegate(&authority, &schema_id, &delegate);

        let stealth_hash = BytesN::from_array(&env, &[0xFFu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let uid = engine_client.attest(
            &authority,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );

        engine_client.revoke_attestation(&delegate, &uid, &schema_id_addr);
    }

    #[test]
    fn test_revoke_by_unauthorized_stranger() {
        let (env, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[9u8; 32]);

        register_schema(&env, &schema_client, &authority, &schema_id, true);

        let stealth_hash = BytesN::from_array(&env, &[0x11u8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let uid = engine_client.attest(
            &authority,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );

        let stranger = Address::generate(&env);
        let result = engine_client.try_revoke_attestation(&stranger, &uid, &schema_id_addr);
        assert_eq!(result, Err(Ok(AttestationError::Unauthorized)));
    }

    #[test]
    fn uid_derivation_is_deterministic_for_same_inputs() {
        let env = Env::default();
        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[2u8; 32]);

        let first = compute_attestation_uid(&env, &schema_id, &stealth_hash, 7, 1);
        let second = compute_attestation_uid(&env, &schema_id, &stealth_hash, 7, 1);

        assert_eq!(first, second);
    }

    #[test]
    fn same_ledger_attestations_receive_distinct_uids() {
        let env = Env::default();
        let (env_inner, authority, schema_id_addr, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env_inner, &[3u8; 32]);
        let stealth_hash = BytesN::from_array(&env_inner, &[4u8; 32]);

        register_schema(&env_inner, &schema_client, &authority, &schema_id, true);

        let data = Bytes::new(&env_inner);
        let ref_uid = BytesN::from_array(&env_inner, &[0u8; 32]);

        let first = engine_client.attest(
            &authority,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data.clone(),
            &0u32,
            &ref_uid,
        );
        let second = engine_client.attest(
            &authority,
            &schema_id,
            &schema_id_addr,
            &stealth_hash,
            &data,
            &0u32,
            &ref_uid,
        );

        assert_ne!(first, second);
    }
}
