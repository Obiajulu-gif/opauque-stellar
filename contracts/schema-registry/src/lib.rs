#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env,
    String as SorobanString, Symbol, Vec,
};

#[contract]
pub struct SchemaRegistry;

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
}

fn schema_key(schema_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(&schema_id.env(), "schema"), schema_id.clone())
}

fn delegate_key(schema_id: &BytesN<32>) -> (Symbol, BytesN<32>) {
    (Symbol::new(&schema_id.env(), "delegates"), schema_id.clone())
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
            (Symbol::new(&env, "SchemaRegistered"),),
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
        delegates.push_back(delegate.clone());
        env.storage().persistent().set(&dkey, &delegates);
        env.events().publish(
            (Symbol::new(&env, "DelegateAdded"),),
            (schema_id, authority, delegate),
        );
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
        let pos = delegates.first_index_of(delegate.clone());
        let idx = pos.ok_or(SchemaError::DelegateNotFound)?;
        let mut updated = Vec::new(&env);
        for i in 0..delegates.len() {
            if i != idx {
                updated.push_back(delegates.get(i).unwrap());
            }
        }
        env.storage().persistent().set(&dkey, &updated);
        env.events().publish(
            (Symbol::new(&env, "DelegateRemoved"),),
            (schema_id, authority, delegate),
        );
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
    use soroban_sdk::{testutils::{Address as _, Events}, Address, Env};

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
    fn test_authority_can_remove_delegate_and_emit_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let delegate = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[8u8; 32]);

        register(&env, &client, &authority, &schema_id, true);
        client.add_delegate(&authority, &schema_id, &delegate);
        let before = env.events().all().len();

        client.remove_delegate(&authority, &schema_id, &delegate);

        assert!(!client.is_authorized_issuer(&schema_id, &delegate));
        assert!(env.events().all().len() > before);
    }

    #[test]
    fn test_non_authority_cannot_remove_delegate() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let non_authority = Address::generate(&env);
        let delegate = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[9u8; 32]);

        register(&env, &client, &authority, &schema_id, true);
        client.add_delegate(&authority, &schema_id, &delegate);

        let result = client.try_remove_delegate(&non_authority, &schema_id, &delegate);

        assert_eq!(result, Err(Ok(SchemaError::Unauthorized)));
        assert!(client.is_authorized_issuer(&schema_id, &delegate));
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
}
