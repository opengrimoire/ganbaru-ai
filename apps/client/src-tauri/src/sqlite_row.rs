macro_rules! impl_sqlite_from_row {
    ($type:ty { $($field:ident),+ $(,)? }) => {
        impl<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> for $type {
            fn from_row(row: &'r sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
                use sqlx::Row;
                Ok(Self {
                    $($field: row.try_get(stringify!($field))?,)+
                })
            }
        }
    };
}
