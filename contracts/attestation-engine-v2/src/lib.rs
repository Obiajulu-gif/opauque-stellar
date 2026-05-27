#![no_std]
use sha2::{Digest, Sha256};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN,
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
}

#[contractevent]
pub struct AttestationCreated {
    pub uid: BytesN<32>,
    pub schema_id: BytesN<32>,
    pub issuer: Address,
    pub stealth_address_hash: BytesN<32>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AttestationError {
    DataTooLarge = 1,
    UnauthorizedIssuer = 2,
    ExpirationInPast = 3,
}

fn attestation_key(uid: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(&uid.env(), "attest"), uid.clone())
}

fn compute_attestation_uid(
    env: &Env,
    schema_id: &BytesN<32>,
    issuer: &Address,
    stealth_hash: &BytesN<32>,
    ledger: u32,
) -> BytesN<32> {
    let mut hasher = Sha256::new();
    hasher.update(schema_id.to_array());
    hasher.update(issuer.to_string().as_bytes());
    hasher.update(stealth_hash.to_array());
    hasher.update(ledger.to_be_bytes());
    BytesN::from_array(env, &hasher.finalize().into())
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
        let uid = compute_attestation_uid(&env, &schema_id, &issuer, &stealth_address_hash, ledger);
        let attestation = Attestation {
            uid: uid.clone(),
            schema_id: schema_id.clone(),
            issuer: issuer.clone(),
            stealth_address_hash,
            data,
            created_at: ledger,
            expiration_ledger,
            revocation_ledger: 0,
            ref_uid,
        };
        env.storage()
            .persistent()
            .set(&attestation_key(&uid), &attestation);
        env.events().publish(
            (Symbol::new(&env, "AttestationCreated"),),
            AttestationCreated {
                uid: uid.clone(),
                schema_id,
                issuer,
                stealth_address_hash,
            },
        );
        Ok(uid)
    }
}
