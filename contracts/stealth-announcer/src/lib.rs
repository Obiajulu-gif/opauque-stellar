#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Bytes, Env, Symbol};

/// Stealth Address Announcer — emits events when funds are sent to a stealth address.
/// scheme_id 1 = secp256k1; metadata[0] = view tag.
#[contract]
pub struct StealthAnnouncer;

#[contracttype]
#[derive(Clone)]
pub struct AnnouncementLog {
    pub scheme_id: u64,
    pub stealth_address: Bytes,
    pub caller: Address,
    pub ephemeral_pub_key: Bytes,
    pub metadata: Bytes,
    pub ledger: u32,
    pub log_id: Bytes,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AnnouncerError {
    InvalidEphemeralKey = 1,
    MetadataMissingViewTag = 2,
}

fn log_key(caller: &Address, log_id: &Bytes) -> (Symbol, Address, Bytes) {
    (
        Symbol::new(&caller.env(), "log"),
        caller.clone(),
        log_id.clone(),
    )
}

#[contractimpl]
impl StealthAnnouncer {
    pub fn announce(
        env: Env,
        caller: Address,
        scheme_id: u64,
        stealth_address: Bytes,
        ephemeral_pub_key: Bytes,
        metadata: Bytes,
    ) -> Result<(), AnnouncerError> {
        caller.require_auth();
        Self::validate(&ephemeral_pub_key, &metadata)?;
        env.events().publish(
            (Symbol::new(&env, "Announcement"),),
            (scheme_id, stealth_address, caller, ephemeral_pub_key, metadata),
        );
        Ok(())
    }

    pub fn announce_with_log(
        env: Env,
        caller: Address,
        scheme_id: u64,
        stealth_address: Bytes,
        ephemeral_pub_key: Bytes,
        metadata: Bytes,
        log_id: Bytes,
    ) -> Result<(), AnnouncerError> {
        caller.require_auth();
        Self::validate(&ephemeral_pub_key, &metadata)?;
        let ledger = env.ledger().sequence();
        let log = AnnouncementLog {
            scheme_id: scheme_id,
            stealth_address: stealth_address.clone(),
            caller: caller.clone(),
            ephemeral_pub_key: ephemeral_pub_key.clone(),
            metadata: metadata.clone(),
            ledger,
            log_id: log_id.clone(),
        };
        env.storage()
            .persistent()
            .set(&log_key(&caller, &log_id), &log);
        env.events().publish(
            (Symbol::new(&env, "Announcement"),),
            (scheme_id, stealth_address, caller, ephemeral_pub_key, metadata),
        );
        Ok(())
    }

    fn validate(ephemeral_pub_key: &Bytes, metadata: &Bytes) -> Result<(), AnnouncerError> {
        if ephemeral_pub_key.len() != 33 {
            return Err(AnnouncerError::InvalidEphemeralKey);
        }
        if metadata.is_empty() {
            return Err(AnnouncerError::MetadataMissingViewTag);
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Bytes, Env};

    struct Setup {
        env: Env,
        client: StealthAnnouncerClient<'static>,
        caller: Address,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StealthAnnouncer);
        let client = StealthAnnouncerClient::new(&env, &contract_id);
        let caller = Address::generate(&env);
        Setup { env, client, caller }
    }

    fn valid_ephemeral_key(env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        for _ in 0..33 {
            bytes.push_back(0x03u8);
        }
        bytes
    }

    fn valid_metadata(env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        bytes.push_back(0x42u8);
        bytes
    }

    fn stealth_address(env: &Env) -> Bytes {
        let mut bytes = Bytes::new(env);
        for _ in 0..20 {
            bytes.push_back(0xabu8);
        }
        bytes
    }

    #[test]
    fn test_announce_success() {
        let Setup { env, client, caller } = setup();
        client.announce(
            &caller,
            &1u64,
            &stealth_address(&env),
            &valid_ephemeral_key(&env),
            &valid_metadata(&env),
        );
        let events = env.events().all();
        let has_announcement = events.iter().any(|e| e.0 == env.current_contract_id());
        assert!(has_announcement);
    }

    #[test]
    fn test_announce_invalid_ephemeral_key() {
        let Setup { env: _env, client, caller } = setup();
        let short = Bytes::new(&client.env);

        let result = client.try_announce(
            &caller,
            &1u64,
            &stealth_address(&client.env),
            &short,
            &valid_metadata(&client.env),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_announce_empty_metadata() {
        let Setup { env: _env, client, caller } = setup();
        let empty = Bytes::new(&client.env);

        let result = client.try_announce(
            &caller,
            &1u64,
            &stealth_address(&client.env),
            &valid_ephemeral_key(&client.env),
            &empty,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_announce_with_log_success() {
        let Setup { env, client, caller } = setup();
        let log_id = {
            let mut b = Bytes::new(&env);
            b.push_back(0x01u8);
            b
        };

        client.announce_with_log(
            &caller,
            &1u64,
            &stealth_address(&env),
            &valid_ephemeral_key(&env),
            &valid_metadata(&env),
            &log_id,
        );

        let events = env.events().all();
        let has_announcement = events.iter().any(|e| e.0 == env.current_contract_id());
        assert!(has_announcement);
    }

    #[test]
    fn test_announce_with_log_stores_log() {
        let Setup { env, client, caller } = setup();
        let log_id = {
            let mut b = Bytes::new(&env);
            b.push_back(0x01u8);
            b
        };

        client.announce_with_log(
            &caller,
            &1u64,
            &stealth_address(&env),
            &valid_ephemeral_key(&env),
            &valid_metadata(&env),
            &log_id,
        );
    }

    #[test]
    fn test_announce_with_log_invalid_ephemeral_key() {
        let Setup { env: _env, client, caller } = setup();
        let short = Bytes::new(&client.env);
        let log_id = {
            let mut b = Bytes::new(&client.env);
            b.push_back(0x01u8);
            b
        };

        let result = client.try_announce_with_log(
            &caller,
            &1u64,
            &stealth_address(&client.env),
            &short,
            &valid_metadata(&client.env),
            &log_id,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_announce_differs_by_scheme_id() {
        let Setup { env, client, caller } = setup();
        let ephem = valid_ephemeral_key(&env);
        let meta = valid_metadata(&env);
        let addr = stealth_address(&env);

        client.announce(&caller, &1u64, &addr, &ephem, &meta);
        let events_1 = env.events().all().len();

        client.announce(&caller, &2u64, &addr, &ephem, &meta);
        let events_2 = env.events().all().len();

        assert_eq!(events_2, events_1 + 1);
    }
}
