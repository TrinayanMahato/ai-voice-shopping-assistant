import os
import psycopg2

def dump_schema():
    conn = psycopg2.connect(
        host=os.environ['DB_HOST'],
        port=int(os.getenv('DB_PORT', '5432')),
        dbname=os.environ['DB_NAME'],
        user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD']
    )
    cursor = conn.cursor()
    
    with open('database_schema_dev.txt', 'w') as f:
        # Get all tables
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
        tables = cursor.fetchall()
        
        for table in tables:
            table_name = table[0]
            f.write(f"--- Table: {table_name} ---\n")
            
            # Get columns
            cursor.execute(f"""
                SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
                FROM information_schema.columns
                WHERE table_name = '{table_name}'
                ORDER BY ordinal_position
            """)
            columns = cursor.fetchall()
            
            for col in columns:
                col_name, data_type, max_len, default_val, is_nullable = col
                type_str = data_type
                if max_len:
                    type_str += f"({max_len})"
                null_str = "NOT NULL" if is_nullable == 'NO' else "NULL"
                default_str = f" DEFAULT {default_val}" if default_val else ""
                
                f.write(f"  {col_name} {type_str} {null_str}{default_str}\n")
            f.write("\n")
            
    print("Schema dumped to database_schema_dev.txt")

if __name__ == '__main__':
    dump_schema()
