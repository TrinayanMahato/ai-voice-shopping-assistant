import os
import psycopg2
import sys

# Credentials are read from environment variables (see .env)
DB_HOST = os.environ['DB_HOST']
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.environ['DB_NAME']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']

def check_ai_orders_schema():
    conn = None
    try:
        # Establish the connection
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        
        cur = conn.cursor()
        
        # Query the information schema
        query = """
        SELECT column_name, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'ai_orders' AND column_name = 'user_id';
        """
        
        cur.execute(query)
        result = cur.fetchone()
        
        if result:
            column_name, is_nullable = result
            print(f"Field '{column_name}' found in table 'ai_orders'.")
            print(f"Is nullable: {is_nullable}")
            if is_nullable == 'YES':
                print("Conclusion: Yes, you can save a NULL value in this field.")
            else:
                print("Conclusion: No, this field has a NOT NULL constraint.")
        else:
            print("Table 'ai_orders' or field 'user_id' not found.")
            
        cur.close()
        
    except (Exception, psycopg2.DatabaseError) as error:
        print(f"Error connecting to the database: {error}")
    finally:
        if conn is not None:
            conn.close()

if __name__ == '__main__':
    check_ai_orders_schema()
