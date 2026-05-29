#![no_std]
use sha2::{Digest, Sha256};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env,
    String as SorobanString, Symbol, Vec,
};

#[contract]
pub struct SchemaRegistry;

/// Current event schema version — increment when the event topic/data layout changes.
/// Scanners should reject events with an unrecognised version rather than misparse them.
const EVENT_VERSION: u32 = 1;

#[contracttype]
#[derive(Clone)]
pub struct Schema {
    pub schema_id: BytesN<32>,
    pub authority: Address,
    pub resolver: Address,
    pub revocable: bool,
    pub name: SorobanString,
    pub field_definitions: SorobanString,
    pub version: u32,
    pub created_at: u32,
    pub schema_expiry_ledger: u32,
    pub deprecated: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SchemaError {
    NameTooLong = 1,
    FieldDefsTooLong = 2,
    InvalidSchemaId = 3,
    Unauthorized = 4,
    DelegateLimitReached = 5,
    DelegateAlreadyExists = 6,
    DelegateNotFound = 7,
    SchemaAlreadyExists = 8,
    InvalidExpiryLedger = 9,
}

fn schema_key(schema_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(&schema_id.env(), "schema"), schema_id.clone())
}

fn delegate_key(schema_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(&schema_id.env(), "delegates"), schema_id.clone())
}

/// Canonical schema ID: SHA-256(authority_bytes || name_utf8 || version_be_u32).
/// authority_bytes = the 32-byte raw account key of the authority Address.
/// Frontend and contract must use this exact formula to agree on schema IDs
/// without a chain round-trip.
pub fn derive_schema_id(
    env: &Env,
    authority_bytes: &BytesN<32>,
    name: &SorobanString,
    version: u32,
) -> BytesN<32> {
    let mut hasher = Sha256::new();
    hasher.update(authority_bytes.to_array());
    // copy name bytes via a stack buffer (name max len = 64, enforced in register_schema)
    let name_len = name.len() as usize;
    let mut name_buf = [0u8; 64];
    name.copy_into_slice(&mut name_buf[..name_len]);
    hasher.update(&name_buf[..name_len]);
    hasher.update(version.to_be_bytes());
    BytesN::from_array(env, &hasher.finalize().into())
}

#[contractimpl]
impl SchemaRegistry {
    pub fn register_schema(
        env: Env,
        authority: Address,
        schema_id: BytesN<32>,
        name: SorobanString,
        field_definitions: SorobanString,
        revocable: bool,
        version: u32,
        resolver: Option<Address>,
        schema_expiry_ledger: u32,
    ) -> Result<(), SchemaError> {
        authority.require_auth();
        if name.len() > 64 {
            return Err(SchemaError::NameTooLong);
        }
        if field_definitions.len() > 256 {
            return Err(SchemaError::FieldDefsTooLong);
        }
        let skey = schema_key(&schema_id);
        if env.storage().persistent().has(&skey) {
            return Err(SchemaError::SchemaAlreadyExists);
        }
        if schema_expiry_ledger != 0 && schema_expiry_ledger <= env.ledger().sequence() {
            return Err(SchemaError::InvalidExpiryLedger);
        }
        let schema = Schema {
            schema_id: schema_id.clone(),
            authority: authority.clone(),
            resolver: resolver.unwrap_or_else(|| {
                Address::from_str(
                    &env,
                    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                )
            }),
            revocable,
            name: name.clone(),
            field_definitions,
            version,
            created_at: env.ledger().sequence(),
            schema_expiry_ledger,
            deprecated: false,
        };
        env.storage().persistent().set(&skey, &schema);
        env.storage()
            .persistent()
            .set(&delegate_key(&schema_id), &Vec::<Address>::new(&env));
        env.events().publish(
            (Symbol::new(&env, "SchemaRegistered"), EVENT_VERSION),
            (schema_id, authority, name),
        );
        Ok(())
    }

    pub fn add_delegate(
        env: Env,
        authority: Address,
        schema_id: BytesN<32>,
        delegate: Address,
    ) -> Result<(), SchemaError> {
        authority.require_auth();
        let skey = schema_key(&schema_id);
        let schema: Schema = env.storage().persistent().get(&skey).expect("schema");
        if schema.authority != authority {
            return Err(SchemaError::Unauthorized);
        }
        let dkey = delegate_key(&schema_id);
        let mut delegates: Vec<Address> = env
            .storage()
            .persistent()
            .get(&dkey)
            .unwrap_or_else(|| Vec::new(&env));
        if delegates.len() >= 10 {
            return Err(SchemaError::DelegateLimitReached);
        }
        if delegates.contains(delegate.clone()) {
            return Err(SchemaError::DelegateAlreadyExists);
        }
        delegates.push_back(delegate);
        env.storage().persistent().set(&dkey, &delegates);
        Ok(())
    }

    pub fn remove_delegate(
        env: Env,
        authority: Address,
        schema_id: BytesN<32>,
        delegate: Address,
    ) -> Result<(), SchemaError> {
        authority.require_auth();
        let skey = schema_key(&schema_id);
        let schema: Schema = env.storage().persistent().get(&skey).expect("schema");
        if schema.authority != authority {
            return Err(SchemaError::Unauthorized);
        }
        let dkey = delegate_key(&schema_id);
        let delegates: Vec<Address> = env
            .storage()
            .persistent()
            .get(&dkey)
            .unwrap_or_else(|| Vec::new(&env));
        let pos = delegates.first_index_of(delegate);
        let idx = pos.ok_or(SchemaError::DelegateNotFound)?;
        let mut updated = Vec::new(&env);
        for i in 0..delegates.len() {
            if i != idx {
                updated.push_back(delegates.get(i).unwrap());
            }
        }
        env.storage().persistent().set(&dkey, &updated);
        Ok(())
    }

    pub fn deprecate_schema(
        env: Env,
        authority: Address,
        schema_id: BytesN<32>,
    ) -> Result<(), SchemaError> {
        authority.require_auth();
        let key = schema_key(&schema_id);
        let mut schema: Schema = env.storage().persistent().get(&key).expect("schema");
        if schema.authority != authority {
            return Err(SchemaError::Unauthorized);
        }
        schema.deprecated = true;
        env.storage().persistent().set(&key, &schema);
        Ok(())
    }

    pub fn is_authorized_issuer(env: Env, schema_id: BytesN<32>, issuer: Address) -> bool {
        let schema: Schema = env
            .storage()
            .persistent()
            .get(&schema_key(&schema_id))
            .expect("schema");
        if schema.authority == issuer {
            return true;
        }
        let delegates: Vec<Address> = env
            .storage()
            .persistent()
            .get(&delegate_key(&schema_id))
            .unwrap_or_else(|| Vec::new(&env));
        delegates.contains(issuer)
    }

    pub fn is_revocable(env: Env, schema_id: BytesN<32>) -> bool {
        let schema: Schema = env
            .storage()
            .persistent()
            .get(&schema_key(&schema_id))
            .expect("schema");
        schema.revocable
    }

    pub fn get_schema(env: Env, schema_id: BytesN<32>) -> Schema {
        env.storage()
            .persistent()
            .get(&schema_key(&schema_id))
            .expect("schema")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env};

    fn register(
        env: &Env,
        client: &SchemaRegistryClient,
        authority: &Address,
        schema_id: &BytesN<32>,
        revocable: bool,
    ) {
        client.register_schema(
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
    fn test_zero_delegates() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[1u8; 32]);

        register(&env, &client, &authority, &schema_id, true);

        assert!(client.is_authorized_issuer(&schema_id, &authority));
        let stranger = Address::generate(&env);
        assert!(!client.is_authorized_issuer(&schema_id, &stranger));
    }

    #[test]
    fn test_one_delegate() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let delegate = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[2u8; 32]);

        register(&env, &client, &authority, &schema_id, false);
        client.add_delegate(&authority, &schema_id, &delegate);

        assert!(client.is_authorized_issuer(&schema_id, &delegate));

        client.remove_delegate(&authority, &schema_id, &delegate);
        assert!(!client.is_authorized_issuer(&schema_id, &delegate));
    }

    #[test]
    fn test_max_delegates() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[3u8; 32]);

        register(&env, &client, &authority, &schema_id, true);

        for _ in 0..10u32 {
            let d = Address::generate(&env);
            client.add_delegate(&authority, &schema_id, &d);
        }

        // 11th delegate should fail
        let extra = Address::generate(&env);
        let result = client.try_add_delegate(&authority, &schema_id, &extra);
        assert!(result.is_err());
    }

    #[test]
    fn test_schema_already_exists() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[4u8; 32]);

        register(&env, &client, &authority, &schema_id, false);
        let result = client.try_register_schema(
            &authority,
            &schema_id,
            &SorobanString::from_str(&env, "Dup"),
            &SorobanString::from_str(&env, "x:u32"),
            &false,
            &1u32,
            &None,
            &0u32,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_is_revocable() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[5u8; 32]);

        register(&env, &client, &authority, &schema_id, true);
        assert!(client.is_revocable(&schema_id));
    }

    // --- issue #42: schema expiry validation ---

    #[test]
    fn test_expiry_zero_is_accepted() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[10u8; 32]);
        // expiry = 0 means no expiry — must succeed regardless of ledger
        client.register_schema(
            &authority,
            &schema_id,
            &SorobanString::from_str(&env, "NoExpiry"),
            &SorobanString::from_str(&env, "f:u32"),
            &false,
            &1u32,
            &None,
            &0u32,
        );
        let schema = client.get_schema(&schema_id);
        assert_eq!(schema.schema_expiry_ledger, 0u32);
    }

    #[test]
    fn test_expiry_in_past_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[11u8; 32]);
        // current ledger sequence is 0 in test env; pass expiry = 0 would mean no-expiry,
        // so pass 1 but bump the ledger to 2 to make it in the past.
        env.ledger().with_mut(|li| li.sequence_number = 5);
        let result = client.try_register_schema(
            &authority,
            &schema_id,
            &SorobanString::from_str(&env, "Stale"),
            &SorobanString::from_str(&env, "f:u32"),
            &false,
            &1u32,
            &None,
            &4u32, // 4 <= current ledger 5 → invalid
        );
        assert_eq!(result, Err(Ok(SchemaError::InvalidExpiryLedger)));
    }

    // --- issue #43: canonical schema ID derivation ---

    #[test]
    fn derive_schema_id_is_deterministic() {
        let env = Env::default();
        let authority_bytes = BytesN::from_array(&env, &[42u8; 32]);
        let name = SorobanString::from_str(&env, "MySchema");
        let first = derive_schema_id(&env, &authority_bytes, &name, 1);
        let second = derive_schema_id(&env, &authority_bytes, &name, 1);
        assert_eq!(first, second);
    }

    #[test]
    fn derive_schema_id_differs_by_version() {
        let env = Env::default();
        let authority_bytes = BytesN::from_array(&env, &[42u8; 32]);
        let name = SorobanString::from_str(&env, "MySchema");
        let v1 = derive_schema_id(&env, &authority_bytes, &name, 1);
        let v2 = derive_schema_id(&env, &authority_bytes, &name, 2);
        assert_ne!(v1, v2);
    }

    #[test]
    fn derive_schema_id_differs_by_name() {
        let env = Env::default();
        let authority_bytes = BytesN::from_array(&env, &[42u8; 32]);
        let a = derive_schema_id(&env, &authority_bytes, &SorobanString::from_str(&env, "Foo"), 1);
        let b = derive_schema_id(&env, &authority_bytes, &SorobanString::from_str(&env, "Bar"), 1);
        assert_ne!(a, b);
    }
}
