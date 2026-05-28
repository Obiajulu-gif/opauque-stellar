#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, IntoVal, Symbol, Vec};

const ROOT_EXPIRY_LEDGERS: u32 = 17_280; // ~1 day at 5s/ledger
const MAX_ROOT_HISTORY: u32 = 100;

#[contract]
pub struct ReputationVerifier;

#[contracttype]
#[derive(Clone)]
pub struct VerifierConfig {
    pub admin: Address,
    pub groth16_verifier: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct MerkleRootEntry {
    pub root: BytesN<32>,
    pub ledger: u32,
    pub dataset_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct NullifierEntry {
    pub used: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReputationError {
    Unauthorized = 1,
    RootExpired = 2,
    InvalidProof = 3,
    NullifierUsed = 4,
    AlreadyInitialized = 5,
    AttestationExpired = 6,
    InvalidDatasetHash = 7,
}

fn root_key(root: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (
        Symbol::new(&root.env(), "merkle_root"),
        root.clone(),
    )
}

fn nullifier_key(n: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (
        Symbol::new(&n.env(), "nullifier"),
        n.clone(),
    )
}

fn history_key(env: &Env) -> Symbol {
    Symbol::new(env, "root_history")
}

#[contractimpl]
impl ReputationVerifier {
    pub fn initialize(env: Env, admin: Address, groth16_verifier: Address) -> Result<(), ReputationError> {
        admin.require_auth();
        if env.storage().instance().has(&Symbol::new(&env, "config")) {
            return Err(ReputationError::AlreadyInitialized);
        }
        let config = VerifierConfig {
            admin: admin.clone(),
            groth16_verifier,
        };
        env.storage().instance().set(&Symbol::new(&env, "config"), &config);
        env.storage()
            .instance()
            .set(&history_key(&env), &Vec::<BytesN<32>>::new(&env));
        Ok(())
    }

    pub fn update_merkle_root(env: Env, admin: Address, root: BytesN<32>, dataset_hash: BytesN<32>) -> Result<(), ReputationError> {
        admin.require_auth();
        let config: VerifierConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .expect("config");
        if config.admin != admin {
            return Err(ReputationError::Unauthorized);
        }
        let ledger = env.ledger().sequence();
        env.storage().persistent().set(
            &root_key(&root),
            &MerkleRootEntry {
                root: root.clone(),
                ledger,
                dataset_hash: dataset_hash.clone(),
            },
        );
        let mut history: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&history_key(&env))
            .unwrap_or(Vec::new(&env));
        if history.len() >= MAX_ROOT_HISTORY {
            history.remove(0);
        }
        history.push_back(root.clone());
        env.storage().instance().set(&history_key(&env), &history);

        env.events().publish(
            (Symbol::new(&env, "MerkleRootPublished"),),
            (root.clone(), ledger, dataset_hash, admin),
        );
        Ok(())
    }

    pub fn get_latest_root(env: Env) -> Result<BytesN<32>, ReputationError> {
        let history: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&history_key(&env))
            .unwrap_or(Vec::new(&env));
        if history.is_empty() {
            return Err(ReputationError::RootExpired);
        }
        let root = history.get(history.len() - 1).unwrap();
        let entry: MerkleRootEntry = env
            .storage()
            .persistent()
            .get(&root_key(&root))
            .ok_or(ReputationError::RootExpired)?;
        let ledger = env.ledger().sequence();
        if ledger.saturating_sub(entry.ledger) > ROOT_EXPIRY_LEDGERS {
            return Err(ReputationError::RootExpired);
        }
        Ok(root)
    }

    pub fn verify_reputation(
        env: Env,
        user: Address,
        groth16_verifier: Address,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        root: BytesN<32>,
        attestation_id: u64,
        external_nullifier: u64,
        nullifier: BytesN<32>,
        expiration_ledger: u32,
    ) -> Result<(), ReputationError> {
        user.require_auth();
        let config: VerifierConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .expect("config");
        if config.groth16_verifier != groth16_verifier {
            return Err(ReputationError::Unauthorized);
        }
        let root_entry: MerkleRootEntry = env
            .storage()
            .persistent()
            .get(&root_key(&root))
            .ok_or(ReputationError::RootExpired)?;
        let ledger = env.ledger().sequence();
        if ledger.saturating_sub(root_entry.ledger) > ROOT_EXPIRY_LEDGERS {
            return Err(ReputationError::RootExpired);
        }
        if expiration_ledger != 0 && ledger > expiration_ledger {
            return Err(ReputationError::AttestationExpired);
        }
        if env
            .storage()
            .persistent()
            .has(&nullifier_key(&nullifier))
        {
            return Err(ReputationError::NullifierUsed);
        }

        // V1 public signal order (canonical — see docs/PUBLIC_SIGNALS.md):
        //   [0] nullifier  [1] is_valid (bound to 1)  [2] merkle_root
        //   [3] attestation_id  [4] external_nullifier
        // This MUST match circuits/stealth_attestation.circom and the frontend
        // prover in frontend/src/lib/reputationProver.ts.
        let mut pub_signals = Vec::new(&env);
        pub_signals.push_back(nullifier.clone());
        let mut one = [0u8; 32];
        one[31] = 1;
        pub_signals.push_back(BytesN::from_array(&env, &one));
        pub_signals.push_back(root.clone());
        pub_signals.push_back(BytesN::from_array(&env, &u64_to_be32(attestation_id)));
        pub_signals.push_back(BytesN::from_array(
            &env,
            &u64_to_be32(external_nullifier),
        ));

        let valid: bool = env.invoke_contract(
            &groth16_verifier,
            &Symbol::new(&env, "verify_proof"),
            (proof_a, proof_b, proof_c, pub_signals).into_val(&env),
        );
        if !valid {
            return Err(ReputationError::InvalidProof);
        }

        env.storage()
            .persistent()
            .set(&nullifier_key(&nullifier), &NullifierEntry { used: true });

        env.events().publish(
            (Symbol::new(&env, "ReputationVerified"),),
            (attestation_id, nullifier, user, root),
        );
        Ok(())
    }
}

fn u64_to_be32(val: u64) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[24..32].copy_from_slice(&val.to_be_bytes());
    bytes
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, BytesN, Env};

    /// A mock verifier contract that always returns true.
    #[contract]
    struct MockVerifier;

    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
    #[repr(u32)]
    pub enum MockVerifierError {
        InvalidPublicSignal = 1,
    }

    #[contractimpl]
    impl MockVerifier {
        pub fn verify_proof(
            _env: Env,
            _proof_a: BytesN<64>,
            _proof_b: BytesN<128>,
            _proof_c: BytesN<64>,
            _pub_signals: Vec<BytesN<32>>,
        ) -> Result<bool, MockVerifierError> {
            Ok(true)
        }
    }

    fn setup() -> (Env, Address, Address, ReputationVerifierClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationVerifier);
        let client = ReputationVerifierClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        (env, admin, contract_id, client)
    }

    fn setup_with_mock() -> (
        Env,
        Address,
        Address,
        ReputationVerifierClient<'static>,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationVerifier);
        let client = ReputationVerifierClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        let mock_id = env.register_contract(None, MockVerifier);
        client.initialize(&admin, &mock_id);
        (env, admin, contract_id, client, mock_id)
    }

    #[test]
    fn test_initialize() {
        let (env, admin, _, client) = setup();
        let groth16_id = Address::generate(&env);
        client.initialize(&admin, &groth16_id);
    }

    #[test]
    fn test_initialize_already_initialized() {
        let (env, admin, _, client) = setup();
        let groth16_id = Address::generate(&env);
        client.initialize(&admin, &groth16_id);
        let result = client.try_initialize(&admin, &groth16_id);
        assert_eq!(result, Err(Ok(ReputationError::AlreadyInitialized)));
    }

    #[test]
    fn test_update_merkle_root() {
        let (env, admin, _, client, mock_id) = setup_with_mock();
        let root = BytesN::from_array(&env, &[1u8; 32]);
        let dataset_hash = BytesN::from_array(&env, &[2u8; 32]);
        client.update_merkle_root(&admin, &root, &dataset_hash);

        let user = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0x99u8; 32]);
        let proof_a = BytesN::from_array(&env, &[0u8; 64]);
        let proof_b = BytesN::from_array(&env, &[0u8; 128]);
        let proof_c = BytesN::from_array(&env, &[0u8; 64]);

        client.verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &1u64,
            &1u64,
            &nullifier,
            &0u32,
        );
    }

    #[test]
    fn test_update_merkle_root_unauthorized() {
        let (env, _, _, client, _) = setup_with_mock();
        let stranger = Address::generate(&env);
        let root = BytesN::from_array(&env, &[3u8; 32]);
        let dataset_hash = BytesN::from_array(&env, &[4u8; 32]);
        let result = client.try_update_merkle_root(&stranger, &root, &dataset_hash);
        assert_eq!(result, Err(Ok(ReputationError::Unauthorized)));
    }

    #[test]
    fn test_get_latest_root_after_update() {
        let (env, admin, _, client, _mock_id) = setup_with_mock();
        let root = BytesN::from_array(&env, &[4u8; 32]);
        let dataset_hash = BytesN::from_array(&env, &[5u8; 32]);
        client.update_merkle_root(&admin, &root, &dataset_hash);

        let latest = client.get_latest_root();
        assert_eq!(latest, root);
    }

    #[test]
    fn test_get_latest_root_empty_history() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationVerifier);
        let client = ReputationVerifierClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);
        client.initialize(&admin, &verifier);

        let result = client.try_get_latest_root();
        assert_eq!(result, Err(Ok(ReputationError::RootExpired)));
    }

    #[test]
    fn test_verify_reputation_root_not_published() {
        let (env, _, _, client, mock_id) = setup_with_mock();
        let user = Address::generate(&env);
        let unknown_root = BytesN::from_array(&env, &[0x11u8; 32]);
        let nullifier = BytesN::from_array(&env, &[0x22u8; 32]);
        let proof_a = BytesN::from_array(&env, &[0u8; 64]);
        let proof_b = BytesN::from_array(&env, &[0u8; 128]);
        let proof_c = BytesN::from_array(&env, &[0u8; 64]);

        let result = client.try_verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &unknown_root,
            &1u64,
            &1u64,
            &nullifier,
            &0u32,
        );
        assert_eq!(result, Err(Ok(ReputationError::RootExpired)));
    }

    #[test]
    fn test_verify_reputation_nullifier_reuse() {
        let (env, admin, _, client, mock_id) = setup_with_mock();
        let root = BytesN::from_array(&env, &[0xAAu8; 32]);
        let dataset_hash = BytesN::from_array(&env, &[0xBBu8; 32]);
        client.update_merkle_root(&admin, &root, &dataset_hash);

        let user = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0xCCu8; 32]);
        let proof_a = BytesN::from_array(&env, &[0u8; 64]);
        let proof_b = BytesN::from_array(&env, &[0u8; 128]);
        let proof_c = BytesN::from_array(&env, &[0u8; 64]);

        client.verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &1u64,
            &1u64,
            &nullifier,
            &0u32,
        );

        let result = client.try_verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &1u64,
            &1u64,
            &nullifier,
            &0u32,
        );
        assert_eq!(result, Err(Ok(ReputationError::NullifierUsed)));
    }

    #[test]
    fn test_verify_reputation_attestation_expired() {
        let (env, admin, _, client, mock_id) = setup_with_mock();
        let root = BytesN::from_array(&env, &[0xDDu8; 32]);
        let dataset_hash = BytesN::from_array(&env, &[0xEEu8; 32]);
        client.update_merkle_root(&admin, &root, &dataset_hash);

        let user = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0xFFu8; 32]);
        let proof_a = BytesN::from_array(&env, &[0u8; 64]);
        let proof_b = BytesN::from_array(&env, &[0u8; 128]);
        let proof_c = BytesN::from_array(&env, &[0u8; 64]);

        env.ledger().set_sequence_number(100);
        let result = client.try_verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &1u64,
            &1u64,
            &nullifier,
            &50u32,
        );
        assert_eq!(result, Err(Ok(ReputationError::AttestationExpired)));
    }

    #[test]
    fn test_verify_reputation_wrong_verifier_address() {
        let (env, admin, _, client, _) = setup_with_mock();
        let root = BytesN::from_array(&env, &[0x33u8; 32]);
        let dataset_hash = BytesN::from_array(&env, &[0x44u8; 32]);
        client.update_merkle_root(&admin, &root, &dataset_hash);

        let user = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0x55u8; 32]);
        let proof_a = BytesN::from_array(&env, &[0u8; 64]);
        let proof_b = BytesN::from_array(&env, &[0u8; 128]);
        let proof_c = BytesN::from_array(&env, &[0u8; 64]);
        let wrong_verifier = Address::generate(&env);

        let result = client.try_verify_reputation(
            &user,
            &wrong_verifier,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &1u64,
            &1u64,
            &nullifier,
            &0u32,
        );
        assert_eq!(result, Err(Ok(ReputationError::Unauthorized)));
    }

    #[test]
    fn test_full_lifecycle_with_mock_verifier() {
        let (env, admin, _, client, mock_id) = setup_with_mock();

        // 1. Publish merkle root
        let root = BytesN::from_array(&env, &[0xAAu8; 32]);
        let dataset_hash = BytesN::from_array(&env, &[0xBBu8; 32]);
        client.update_merkle_root(&admin, &root, &dataset_hash);

        // 2. Verify reputation (first time — succeeds)
        let user = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0xCCu8; 32]);
        let proof_a = BytesN::from_array(&env, &[0u8; 64]);
        let proof_b = BytesN::from_array(&env, &[0u8; 128]);
        let proof_c = BytesN::from_array(&env, &[0u8; 64]);

        client.verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &42u64,
            &1u64,
            &nullifier,
            &0u32,
        );

        // 3. Replay with same nullifier — rejected
        let result = client.try_verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &42u64,
            &1u64,
            &nullifier,
            &0u32,
        );
        assert_eq!(result, Err(Ok(ReputationError::NullifierUsed)));

        // 4. Different nullifier — succeeds again
        let nullifier2 = BytesN::from_array(&env, &[0xDDu8; 32]);
        client.verify_reputation(
            &user,
            &mock_id,
            &proof_a,
            &proof_b,
            &proof_c,
            &root,
            &42u64,
            &1u64,
            &nullifier2,
            &0u32,
        );
    }

    #[test]
    fn test_update_merkle_root_caps_history() {
        let (env, admin, _, client, _mock_id) = setup_with_mock();

        for i in 0u8..105u8 {
            let root = BytesN::from_array(&env, &[i; 32]);
            let _ = client.try_update_merkle_root(&admin, &root, &root);
        }

        let latest = client.get_latest_root();
        let expected = BytesN::from_array(&env, &[104u8; 32]);
        assert_eq!(latest, expected);
    }
}
