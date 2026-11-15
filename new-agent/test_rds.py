import asyncio, asyncpg, os

async def test_rds():
    try:
        db_host = os.environ["DB_HOST"]
        db_user = os.environ["DB_USER"]
        db_password = os.environ["DB_PASSWORD"]
        db_name = os.environ["DB_NAME"]
        db_port = 5432
        
        print(f"Connecting to {db_host}...")
        conn = await asyncpg.connect(
            user=db_user,
            password=db_password,
            database=db_name,
            host=db_host,
            port=db_port,
            ssl=False # Try without SSL first, or True if required
        )
        print("Connected!")
        
        row = await conn.fetchrow("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 1;")
        print("Successfully fetched a table name:", row)
        
        await conn.close()
    except Exception as e:
        print("Failed to connect or fetch:", e)

asyncio.run(test_rds())
