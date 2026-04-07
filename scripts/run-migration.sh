#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Database Migration Tool${NC}\n"

# New database URL
NEW_DB_URL="postgresql://neondb_owner:npg_EgN2MlYnfSk0@ep-flat-dream-aet8mzr6.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Step 1: Set up schema on new database
echo -e "${YELLOW}📦 Step 1: Setting up schema on new database...${NC}"
DATABASE_URL="$NEW_DB_URL" npx drizzle-kit push --force

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to set up schema on new database${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Schema set up successfully${NC}\n"

# Step 2: Copy data from old to new database
echo -e "${YELLOW}📦 Step 2: Copying data from old to new database...${NC}"
tsx scripts/migrate-database.ts

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Data migration failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Migration completed successfully!${NC}"
echo -e "${YELLOW}⚠️  Next step: Update your DATABASE_URL secret to point to the new database${NC}"
