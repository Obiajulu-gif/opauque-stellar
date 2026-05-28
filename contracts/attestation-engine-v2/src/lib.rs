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
    NotInitialized = 9,
    AlreadyInitialized = 10,
}

fn attestation_key(uid: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(&uid.env(), "attest"), uid.clone())
}

fn registry_key(env: &Env) -> Symbol {
    Symbol::new(env, "schema_reg")
}

fn load_registry(env: &Env) -> Result<Address, AttestationError> {
    env.storage()
        .instance()
        .get(&registry_key(env))
        .ok_or(AttestationError::NotInitialized)
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
    /// One-time initialiser. Stores the trusted schema registry address.
    /// Must be called before `attest` or `revoke_attestation`.
    pub fn initialize(
        env: Env,
        admin: Address,
        schema_registry: Address,
    ) -> Result<(), AttestationError> {
        admin.require_auth();
        let key = registry_key(&env);
        if env.storage().instance().has(&key) {
            return Err(AttestationError::AlreadyInitialized);
        }
        env.storage().instance().set(&key, &schema_registry);
        Ok(())
    }

    pub fn attest(
        env: Env,
        issuer: Address,
        schema_id: BytesN<32>,
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
        let schema_registry = load_registry(&env)?;
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
    ) -> Result<(), AttestationError> {
        revoker.require_auth();
        let schema_registry = load_registry(&env)?;
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

    /// Returns the stored attestation for the given UID (#46).
    pub fn get_attestation(
        env: Env,
        uid: BytesN<32>,
    ) -> Result<Attestation, AttestationError> {
        env.storage()
            .persistent()
            .get(&attestation_key(&uid))
            .ok_or(AttestationError::AttestationNotFound)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    extern crate schema_registry;
    use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String as SorobanString};

    // Mock registry that always denies — used by the unauthorized-registry security test (#47).
    #[contract]
    struct UnauthorizedRegistry;

    #[contractimpl]
    impl UnauthorizedRegistry {
        pub fn is_authorized_issuer(_env: Env, _schema_id: BytesN<32>, _issuer: Address) -> bool {
            false
        }

        pub fn is_revocable(_env: Env, _schema_id: BytesN<32>) -> bool {
            false
        }
    }

    // Returns (env, authority/admin, engine_contract_id, schema_client, engine_client).
    // Engine is pre-initialized against the real schema registry (#47).
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
        engine_client.initialize(&authority, &schema_contract_id);
        (env, authority, engine_contract_id, schema_client, engine_client)
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

    // --- integration tests (schema_registry param removed from attest/revoke per #47) ---

    #[test]
    fn test_attest_valid() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[1u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        let stealth_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
        let data = Bytes::from_array(&env, &[1u8, 2u8, 3u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let uid = engine_client.attest(&authority, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        assert!(uid.to_array() != [0u8; 32]);
    }

    #[test]
    fn test_attest_unauthorized_issuer() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[2u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        let stranger = Address::generate(&env);
        let stealth_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let result = engine_client.try_attest(&stranger, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        assert_eq!(result, Err(Ok(AttestationError::UnauthorizedIssuer)));
    }

    #[test]
    fn test_attest_delegate_authorized() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[3u8; 32]);
        let delegate = Address::generate(&env);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        schema_client.add_delegate(&authority, &schema_id, &delegate);
        let stealth_hash = BytesN::from_array(&env, &[0xBBu8; 32]);
        let data = Bytes::from_array(&env, &[4u8, 5u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let uid = engine_client.attest(&delegate, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        assert!(uid.to_array() != [0u8; 32]);
    }

    #[test]
    fn test_attest_data_too_large() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[4u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        let stealth_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
        let big_data = Bytes::from_array(&env, &[0u8; 513]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let result = engine_client.try_attest(&authority, &schema_id, &stealth_hash, &big_data, &0u32, &ref_uid);
        assert_eq!(result, Err(Ok(AttestationError::DataTooLarge)));
    }

    #[test]
    fn test_revoke_attestation() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[5u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        let stealth_hash = BytesN::from_array(&env, &[0xCCu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let uid = engine_client.attest(&authority, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        engine_client.revoke_attestation(&authority, &uid);
    }

    #[test]
    fn test_revoke_not_found() {
        let (env, authority, _engine_id, _schema_client, engine_client) = setup();
        let fake_uid = BytesN::from_array(&env, &[0xFFu8; 32]);
        let result = engine_client.try_revoke_attestation(&authority, &fake_uid);
        assert_eq!(result, Err(Ok(AttestationError::AttestationNotFound)));
    }

    #[test]
    fn test_revoke_not_revocable_schema() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[7u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, false);
        let stealth_hash = BytesN::from_array(&env, &[0xEEu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let uid = engine_client.attest(&authority, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        let result = engine_client.try_revoke_attestation(&authority, &uid);
        assert_eq!(result, Err(Ok(AttestationError::NotRevocable)));
    }

    #[test]
    fn test_revoke_by_delegate() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[8u8; 32]);
        let delegate = Address::generate(&env);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        schema_client.add_delegate(&authority, &schema_id, &delegate);
        let stealth_hash = BytesN::from_array(&env, &[0xFFu8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let uid = engine_client.attest(&authority, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        engine_client.revoke_attestation(&delegate, &uid);
    }

    #[test]
    fn test_revoke_by_unauthorized_stranger() {
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[9u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        let stealth_hash = BytesN::from_array(&env, &[0x11u8; 32]);
        let data = Bytes::from_array(&env, &[1u8]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let uid = engine_client.attest(&authority, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        let stranger = Address::generate(&env);
        let result = engine_client.try_revoke_attestation(&stranger, &uid);
        assert_eq!(result, Err(Ok(AttestationError::Unauthorized)));
    }

    // --- UID derivation tests ---

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
        let (env, authority, _engine_id, schema_client, engine_client) = setup();
        let schema_id = BytesN::from_array(&env, &[3u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[4u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        let data = Bytes::new(&env);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let first = engine_client.attest(&authority, &schema_id, &stealth_hash, &data.clone(), &0u32, &ref_uid);
        let second = engine_client.attest(&authority, &schema_id, &stealth_hash, &data, &0u32, &ref_uid);
        assert_ne!(first, second);
    }

    #[test]
    fn duplicate_uid_is_rejected_before_storage() {
        let (env, authority, engine_id, schema_client, client) = setup();
        let schema_id = BytesN::from_array(&env, &[5u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[6u8; 32]);
        let data = Bytes::new(&env);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        // Register the schema so authorization passes on the first attest attempt.
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        // Pre-seed the storage with the uid that the first attest call would produce
        // (issuance_sequence=1, ledger=0), so the engine hits AlreadyExists instead of
        // writing a new entry.
        let uid = compute_attestation_uid(&env, &schema_id, &stealth_hash, env.ledger().sequence(), 1);
        let key = attestation_key(&uid);
        let existing = Attestation {
            uid: uid.clone(),
            schema_id: schema_id.clone(),
            issuer: authority.clone(),
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
        let result = client.try_attest(&authority, &schema_id, &stealth_hash, &data, &0, &ref_uid);
        assert_eq!(result, Err(Ok(AttestationError::AttestationAlreadyExists)));
    }

    // --- issue #46: get_attestation read API ---

    #[test]
    fn get_attestation_returns_stored_record() {
        let (env, authority, _engine_id, schema_client, client) = setup();
        let schema_id = BytesN::from_array(&env, &[7u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[8u8; 32]);
        let data = Bytes::new(&env);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        register_schema(&env, &schema_client, &authority, &schema_id, true);
        let uid = client.attest(&authority, &schema_id, &stealth_hash, &data, &0, &ref_uid);
        let att = client.get_attestation(&uid);
        assert_eq!(att.uid, uid);
        assert_eq!(att.issuer, authority);
        assert_eq!(att.schema_id, schema_id);
        assert_eq!(att.revocation_ledger, 0u32);
    }

    #[test]
    fn get_attestation_returns_not_found_for_unknown_uid() {
        let (env, _authority, _engine_id, _schema_client, client) = setup();
        let unknown_uid = BytesN::from_array(&env, &[99u8; 32]);
        match client.try_get_attestation(&unknown_uid) {
            Err(Ok(AttestationError::AttestationNotFound)) => {}
            _ => panic!("expected AttestationNotFound"),
        }
    }

    // --- issue #47: registry binding security ---

    #[test]
    fn attest_fails_before_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let engine_id = env.register_contract(None, AttestationEngineV2);
        let client = AttestationEngineV2Client::new(&env, &engine_id);
        let issuer = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[20u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[21u8; 32]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_attest(&issuer, &schema_id, &stealth_hash, &Bytes::new(&env), &0, &ref_uid);
        assert_eq!(result, Err(Ok(AttestationError::NotInitialized)));
    }

    #[test]
    fn initialize_twice_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let schema_contract_id = env.register_contract(None, schema_registry::SchemaRegistry);
        let engine_id = env.register_contract(None, AttestationEngineV2);
        let client = AttestationEngineV2Client::new(&env, &engine_id);
        let admin = Address::generate(&env);
        client.initialize(&admin, &schema_contract_id);
        let result = client.try_initialize(&admin, &schema_contract_id);
        assert_eq!(result, Err(Ok(AttestationError::AlreadyInitialized)));
    }

    #[test]
    fn unauthorized_issuer_is_rejected_via_stored_registry() {
        let env = Env::default();
        env.mock_all_auths();
        let bad_registry_id = env.register_contract(None, UnauthorizedRegistry);
        let engine_id = env.register_contract(None, AttestationEngineV2);
        let admin = Address::generate(&env);
        let client = AttestationEngineV2Client::new(&env, &engine_id);
        client.initialize(&admin, &bad_registry_id);
        let issuer = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[30u8; 32]);
        let stealth_hash = BytesN::from_array(&env, &[31u8; 32]);
        let ref_uid = BytesN::from_array(&env, &[0u8; 32]);
        let result = client.try_attest(&issuer, &schema_id, &stealth_hash, &Bytes::new(&env), &0, &ref_uid);
        assert_eq!(result, Err(Ok(AttestationError::UnauthorizedIssuer)));
    }
}
