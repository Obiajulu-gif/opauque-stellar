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
            &Symbol::new(&env, "can_issue"),
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

    pub fn get_attestation(env: Env, uid: BytesN<32>) -> Result<Attestation, AttestationError> {
        env.storage()
            .persistent()
            .get(&attestation_key(&uid))
            .ok_or(AttestationError::AttestationNotFound)
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
    use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env};

    #[contract]
    struct AuthorizedRegistry;

    #[contractimpl]
    impl AuthorizedRegistry {
        pub fn is_authorized_issuer(_env: Env, _schema_id: BytesN<32>, _issuer: Address) -> bool {
            true
        }

        pub fn can_issue(_env: Env, _schema_id: BytesN<32>, _issuer: Address) -> bool {
            true
        }

        pub fn is_revocable(_env: Env, _schema_id: BytesN<32>) -> bool {
            true
        }
    }

    #[contract]
    struct InactiveRegistry;

    #[contractimpl]
    impl InactiveRegistry {
        pub fn is_authorized_issuer(_env: Env, _schema_id: BytesN<32>, _issuer: Address) -> bool {
            true
        }

        pub fn can_issue(_env: Env, _schema_id: BytesN<32>, _issuer: Address) -> bool {
            false
        }

        pub fn is_revocable(_env: Env, _schema_id: BytesN<32>) -> bool {
            true
        }
    }

    fn setup(env: &Env) -> (AttestationEngineV2Client<'_>, Address, Address) {
        env.mock_all_auths();
        let engine_id = env.register(AttestationEngineV2, ());
        let registry_id = env.register(AuthorizedRegistry, ());
        (
            AttestationEngineV2Client::new(env, &engine_id),
            engine_id,
            registry_id,
        )
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
    fn inactive_schema_rejects_new_attestations() {
        let env = Env::default();
        env.mock_all_auths();
        let engine_id = env.register(AttestationEngineV2, ());
        let registry_id = env.register(InactiveRegistry, ());
        let client = AttestationEngineV2Client::new(&env, &engine_id);
        let issuer = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[7u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[8u8; 32]);
        let data = Bytes::new(&env);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let result = client.try_attest(
            &issuer,
            &schema_id,
            &registry_id,
            &stealth_hash,
            &data,
            &0,
            &ref_uid,
        );

        assert_eq!(result, Err(Ok(AttestationError::UnauthorizedIssuer)));
    }

    #[test]
    fn existing_valid_attestation_remains_readable() {
        let env = Env::default();
        let (client, _engine_id, registry_id) = setup(&env);
        let issuer = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[9u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[10u8; 32]);
        let data = Bytes::new(&env);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let uid = client.attest(
            &issuer,
            &schema_id,
            &registry_id,
            &stealth_hash,
            &data,
            &0,
            &ref_uid,
        );

        let saved = client.get_attestation(&uid);
        assert_eq!(saved.uid, uid);
        assert_eq!(saved.schema_id, schema_id);
        assert_eq!(saved.issuer, issuer);
    }

    #[test]
    fn same_ledger_attestations_receive_distinct_uids() {
        let env = Env::default();
        let (client, _engine_id, registry_id) = setup(&env);
        let issuer = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[3u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[4u8; 32]);
        let data = Bytes::new(&env);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);

        let first = client.attest(
            &issuer,
            &schema_id,
            &registry_id,
            &stealth_hash,
            &data,
            &0,
            &ref_uid,
        );
        let second = client.attest(
            &issuer,
            &schema_id,
            &registry_id,
            &stealth_hash,
            &data,
            &0,
            &ref_uid,
        );

        assert_ne!(first, second);
    }

    #[test]
    fn duplicate_uid_is_rejected_before_storage() {
        let env = Env::default();
        let (client, engine_id, registry_id) = setup(&env);
        let issuer = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[5u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[6u8; 32]);
        let data = Bytes::new(&env);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let uid = compute_attestation_uid(
            &env,
            &schema_id,
            &stealth_hash,
            env.ledger().sequence(),
            1,
        );
        let key = attestation_key(&uid);
        let existing = Attestation {
            uid: uid.clone(),
            schema_id: schema_id.clone(),
            issuer: issuer.clone(),
            stealth_address_hash: stealth_hash.clone(),
            data: Bytes::new(&env),
            created_at: env.ledger().sequence(),
            expiration_ledger: 0,
            revocation_ledger: 0,
            ref_uid: ref_uid.clone(),
            issuance_sequence: 1,
        };

        env.as_contract(&engine_id, || {
            env.storage().persistent().set(&key, &existing);
        });

        let result = client.try_attest(
            &issuer,
            &schema_id,
            &registry_id,
            &stealth_hash,
            &data,
            &0,
            &ref_uid,
        );

        assert_eq!(result, Err(Ok(AttestationError::AttestationAlreadyExists)));
    }
}
