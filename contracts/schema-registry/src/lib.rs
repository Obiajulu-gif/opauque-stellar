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

#[contracttype]
#[derive(Clone)]
pub struct SchemaStatus {
    pub revocable: bool,
    pub deprecated: bool,
    pub schema_expiry_ledger: u32,
    pub active: bool,
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

fn schema_ids_key(env: &Env) -> Symbol {
    Symbol::new(env, "schema_ids")
}

fn is_schema_active(env: &Env, schema: &Schema) -> bool {
    !schema.deprecated
        && (schema.schema_expiry_ledger == 0 || schema.schema_expiry_ledger > env.ledger().sequence())
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

        let ids_key = schema_ids_key(&env);
        let mut schema_ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&ids_key)
            .unwrap_or_else(|| Vec::new(&env));
        schema_ids.push_back(schema_id.clone());
        env.storage().persistent().set(&ids_key, &schema_ids);

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

    pub fn get_delegates(env: Env, schema_id: BytesN<32>) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&delegate_key(&schema_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_schema_status(env: Env, schema_id: BytesN<32>) -> SchemaStatus {
        let schema: Schema = env
            .storage()
            .persistent()
            .get(&schema_key(&schema_id))
            .expect("schema");
        SchemaStatus {
            revocable: schema.revocable,
            deprecated: schema.deprecated,
            schema_expiry_ledger: schema.schema_expiry_ledger,
            active: is_schema_active(&env, &schema),
        }
    }

    pub fn list_schema_ids(env: Env, start: u32, limit: u32) -> Vec<BytesN<32>> {
        let schema_ids: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&schema_ids_key(&env))
            .unwrap_or_else(|| Vec::new(&env));
        let mut page = Vec::new(&env);
        let end = start.saturating_add(limit).min(schema_ids.len());
        for i in start..end {
            page.push_back(schema_ids.get(i).unwrap());
        }
        page
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

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
    fn schema_by_id_can_be_fetched() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[1u8; 32]);

        register(&env, &client, &authority, &schema_id, true);

        let schema = client.get_schema(&schema_id);
        assert_eq!(schema.schema_id, schema_id);
        assert_eq!(schema.authority, authority);
        assert!(schema.revocable);
    }

    #[test]
    fn delegates_and_status_fields_are_readable() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let delegate = Address::generate(&env);
        let schema_id = BytesN::from_array(&env, &[2u8; 32]);

        register(&env, &client, &authority, &schema_id, false);
        client.add_delegate(&authority, &schema_id, &delegate);

        let delegates = client.get_delegates(&schema_id);
        let status = client.get_schema_status(&schema_id);

        assert_eq!(delegates.len(), 1);
        assert_eq!(delegates.get(0).unwrap(), delegate);
        assert!(!status.revocable);
        assert!(!status.deprecated);
        assert!(status.active);
    }

    #[test]
    fn schema_ids_are_paginated() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SchemaRegistry);
        let client = SchemaRegistryClient::new(&env, &contract_id);
        let authority = Address::generate(&env);
        let first = BytesN::from_array(&env, &[3u8; 32]);
        let second = BytesN::from_array(&env, &[4u8; 32]);
        let third = BytesN::from_array(&env, &[5u8; 32]);

        register(&env, &client, &authority, &first, true);
        register(&env, &client, &authority, &second, true);
        register(&env, &client, &authority, &third, true);

        let page = client.list_schema_ids(&1u32, &2u32);
        assert_eq!(page.len(), 2);
        assert_eq!(page.get(0).unwrap(), second);
        assert_eq!(page.get(1).unwrap(), third);
    }
}
