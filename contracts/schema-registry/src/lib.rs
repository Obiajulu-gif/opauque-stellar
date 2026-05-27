#![no_std]
use sha2::{Digest, Sha256};
use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env, String as SorobanString, Symbol, Vec as SorobanVec};

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
    pub delegates: SorobanVec<Address>,
    pub created_at: u32,
    pub schema_expiry_ledger: u32,
    pub deprecated: bool,
}

#[contractevent]
pub struct SchemaRegistered {
    pub schema_id: BytesN<32>,
    pub authority: Address,
    pub name: SorobanString,
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

pub fn compute_schema_id(env: &Env, authority: &Address, name: &str, version: u32) -> BytesN<32> {
    let mut hasher = Sha256::new();
    hasher.update(authority.to_string().as_bytes());
    hasher.update(name.as_bytes());
    hasher.update(version.to_be_bytes());
    let digest = hasher.finalize();
    BytesN::from_array(env, &digest.into())
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
        if env.storage().persistent().has(&schema_key(&schema_id)) {
            return Err(SchemaError::SchemaAlreadyExists);
        }
        let name_str = name.to_string();
        let expected = compute_schema_id(&env, &authority, &name_str, version);
        if schema_id != expected {
            return Err(SchemaError::InvalidSchemaId);
        }
        let schema = Schema {
            schema_id: schema_id.clone(),
            authority: authority.clone(),
            resolver: resolver.unwrap_or_else(|| Address::from_str(&env, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")),
            revocable,
            name: name.clone(),
            field_definitions,
            delegates: SorobanVec::new(&env),
            version,
            created_at: env.ledger().sequence(),
            schema_expiry_ledger,
            deprecated: false,
        };
        env.storage().persistent().set(&schema_key(&schema_id), &schema);
        env.events().publish(
            (Symbol::new(&env, "SchemaRegistered"),),
            SchemaRegistered {
                schema_id,
                authority,
                name,
            },
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
        let key = schema_key(&schema_id);
        let mut schema: Schema = env.storage().persistent().get(&key).expect("schema");
        if schema.authority != authority {
            return Err(SchemaError::Unauthorized);
        }
        if schema.delegates.len() >= 10 {
            return Err(SchemaError::DelegateLimitReached);
        }
        if schema.delegates.contains(delegate.clone()) {
            return Err(SchemaError::DelegateAlreadyExists);
        }
        schema.delegates.push_back(delegate);
        env.storage().persistent().set(&key, &schema);
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
        schema.delegates.contains(issuer)
    }
}
