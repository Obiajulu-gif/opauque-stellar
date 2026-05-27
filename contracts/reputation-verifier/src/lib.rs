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
