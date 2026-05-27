#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Bytes, Env, Symbol};

/// Stealth Meta-Address Registry — maps Stellar accounts to stealth meta-addresses.
/// Equivalent to ERC-6538. scheme_id 1 = secp256k1 with view tags.
#[contract]
pub struct StealthRegistry;

#[contracttype]
#[derive(Clone)]
pub struct RegistryEntry {
    pub registrant: Address,
    pub scheme_id: u64,
    pub stealth_meta_address: Bytes,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    InvalidMetaAddress = 1,
}

fn registry_key(registrant: &Address, scheme_id: u64) -> (Symbol, Address, u64) {
    (Symbol::new(&registrant.env(), "entry"), registrant.clone(), scheme_id)
}

fn nonce_key(registrant: &Address) -> (Symbol, Address) {
    (Symbol::new(&registrant.env(), "nonce"), registrant.clone())
}

#[contractimpl]
impl StealthRegistry {
    pub fn register_keys(
        env: Env,
        registrant: Address,
        scheme_id: u64,
        stealth_meta_address: Bytes,
    ) -> Result<(), RegistryError> {
        registrant.require_auth();
        if stealth_meta_address.len() != 66 {
            return Err(RegistryError::InvalidMetaAddress);
        }
        let entry = RegistryEntry {
            registrant: registrant.clone(),
            scheme_id,
            stealth_meta_address: stealth_meta_address.clone(),
        };
        env.storage()
            .persistent()
            .set(&registry_key(&registrant, scheme_id), &entry);
        env.events().publish(
            (Symbol::new(&env, "StealthMetaAddressSet"),),
            (registrant, scheme_id, stealth_meta_address),
        );
        Ok(())
    }

    pub fn increment_nonce(env: Env, registrant: Address) -> u64 {
        registrant.require_auth();
        let key = nonce_key(&registrant);
        let nonce: u64 = env.storage().persistent().get(&key).unwrap_or(0);
        let new_nonce = nonce.saturating_add(1);
        env.storage().persistent().set(&key, &new_nonce);
        env.events().publish(
            (Symbol::new(&env, "NonceIncremented"),),
            (registrant.clone(), new_nonce),
        );
        new_nonce
    }

    pub fn resolve(env: Env, registrant: Address, scheme_id: u64) -> Option<Bytes> {
        env.storage()
            .persistent()
            .get::<_, RegistryEntry>(&registry_key(&registrant, scheme_id))
            .map(|e| e.stealth_meta_address)
    }
}
