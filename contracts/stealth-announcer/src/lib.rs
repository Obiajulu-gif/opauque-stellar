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
