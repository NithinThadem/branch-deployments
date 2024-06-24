### Steps
1. Setup postgresql database and have it running locally
2. createuser -P -d thoughtlead
3. createdb -O thoughtlead thoughtlead
4. copy .env.example to .env and fill in the values (username, password, database)
5. yarn install
6. yarn db:migrate:generate
7. yarn db:migrate
6. yarn dev