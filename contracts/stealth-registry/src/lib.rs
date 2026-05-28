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

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Bytes, Env};

    struct Setup {
        env: Env,
        client: StealthRegistryClient<'static>,
        registrant: Address,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StealthRegistry);
        let client = StealthRegistryClient::new(&env, &contract_id);
        let registrant = Address::generate(&env);
        Setup { env, client, registrant }
    }

    fn valid_meta_address(env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        for _ in 0..66 {
            bytes.push_back(0x01u8);
        }
        bytes
    }

    #[test]
    fn test_register_keys_success() {
        let Setup { env, client, registrant } = setup();
        let meta = valid_meta_address(&env);
        let scheme_id: u64 = 1;

        client.register_keys(&registrant, &scheme_id, &meta);

        let resolved = client.resolve(&registrant, &scheme_id);
        assert_eq!(resolved, Some(meta));
    }

    #[test]
    fn test_register_keys_invalid_meta_address_length() {
        let Setup { env: _env, client, registrant } = setup();
        let short = Bytes::new(&client.env);
        let scheme_id: u64 = 1;

        let result = client.try_register_keys(&registrant, &scheme_id, &short);
        assert!(result.is_err());
    }

    #[test]
    fn test_register_keys_overwrites_existing() {
        let Setup { env, client, registrant } = setup();
        let scheme_id: u64 = 1;
        let meta_a = valid_meta_address(&env);

        client.register_keys(&registrant, &scheme_id, &meta_a);

        let mut meta_b = Bytes::new(&env);
        for _ in 0..66 {
            meta_b.push_back(0x02u8);
        }
        client.register_keys(&registrant, &scheme_id, &meta_b);

        let resolved = client.resolve(&registrant, &scheme_id);
        assert_eq!(resolved, Some(meta_b));
    }

    #[test]
    fn test_increment_nonce_from_zero() {
        let Setup { client, registrant, .. } = setup();

        let nonce = client.increment_nonce(&registrant);
        assert_eq!(nonce, 1);
    }

    #[test]
    fn test_increment_nonce_multiple() {
        let Setup { client, registrant, .. } = setup();

        assert_eq!(client.increment_nonce(&registrant), 1);
        assert_eq!(client.increment_nonce(&registrant), 2);
        assert_eq!(client.increment_nonce(&registrant), 3);
    }

    #[test]
    fn test_resolve_not_found() {
        let Setup { client, registrant, .. } = setup();
        let stranger = Address::generate(&client.env);

        let result = client.resolve(&stranger, &1u64);
        assert_eq!(result, None);
    }

    #[test]
    fn test_resolve_different_scheme_ids() {
        let Setup { env, client, registrant } = setup();
        let meta = valid_meta_address(&env);

        client.register_keys(&registrant, &1u64, &meta);

        let not_found = client.resolve(&registrant, &2u64);
        assert_eq!(not_found, None);

        let found = client.resolve(&registrant, &1u64);
        assert_eq!(found, Some(meta));
    }

    #[test]
    fn test_register_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StealthRegistry);
        let client = StealthRegistryClient::new(&env, &contract_id);
        let registrant = Address::generate(&env);
        let meta = valid_meta_address(&env);

        client.register_keys(&registrant, &1u64, &meta);

        let events = env.events().all();
        let found = events.iter().any(|e| {
            e.0 == contract_id && {
                let topics = e.1.clone();
                !topics.is_empty()
            }
        });
        assert!(found);
    }

    #[test]
    fn test_increment_nonce_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StealthRegistry);
        let client = StealthRegistryClient::new(&env, &contract_id);
        let registrant = Address::generate(&env);

        client.increment_nonce(&registrant);

        let events = env.events().all();
        let found = events.iter().any(|e| e.0 == contract_id);
        assert!(found);
    }
}
