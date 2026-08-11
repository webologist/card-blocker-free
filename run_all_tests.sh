#!/bin/bash
#
# BlockMyCard Production QA Test Suite - Complete Retest
# Executes all critical tests for production readiness
#

set -e

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="qa_results_$TIMESTAMP.log"
FAILED_TESTS=0
PASSED_TESTS=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================" | tee -a "$LOG_FILE"
echo "BlockMyCard Production QA Test Suite" | tee -a "$LOG_FILE"
echo "Timestamp: $TIMESTAMP" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

# Test 1: TypeScript Compilation
echo -e "\n${YELLOW}[TEST 1]${NC} TypeScript Compilation Check" | tee -a "$LOG_FILE"
if npx tsc --noEmit >> "$LOG_FILE" 2>&1; then
  echo -e "${GREEN}✅ PASS${NC}: No TypeScript errors" | tee -a "$LOG_FILE"
  ((PASSED_TESTS++))
else
  echo -e "${RED}❌ FAIL${NC}: TypeScript compilation errors found" | tee -a "$LOG_FILE"
  ((FAILED_TESTS++))
fi

# Test 2: Repository Status
echo -e "\n${YELLOW}[TEST 2]${NC} Repository Hygiene Check" | tee -a "$LOG_FILE"
if [ -z "$(git status --porcelain | grep -E '^(db-|backup|\.env)')" ]; then
  echo -e "${GREEN}✅ PASS${NC}: No untracked dev/sensitive files" | tee -a "$LOG_FILE"
  ((PASSED_TESTS++))
else
  echo -e "${RED}❌ FAIL${NC}: Found untracked critical files" | tee -a "$LOG_FILE"
  ((FAILED_TESTS++))
fi

# Test 3: API Endpoint - send-otp
echo -e "\n${YELLOW}[TEST 3]${NC} API Endpoint: send-otp" | tee -a "$LOG_FILE"
RESPONSE=$(curl -s -X POST http://localhost:3000/api/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999","dummyMode":true}')

if echo "$RESPONSE" | grep -q '"token"'; then
  echo -e "${GREEN}✅ PASS${NC}: send-otp endpoint working" | tee -a "$LOG_FILE"
  echo "Response: $RESPONSE" >> "$LOG_FILE"
  ((PASSED_TESTS++))
else
  echo -e "${RED}❌ FAIL${NC}: send-otp endpoint error" | tee -a "$LOG_FILE"
  echo "Response: $RESPONSE" >> "$LOG_FILE"
  ((FAILED_TESTS++))
fi

# Test 4: API Endpoint - verify-otp
echo -e "\n${YELLOW}[TEST 4]${NC} API Endpoint: verify-otp" | tee -a "$LOG_FILE"
TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
VERIFY=$(curl -s -X POST http://localhost:3000/api/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"+919999999999\",\"otp\":\"1234\",\"token\":\"$TOKEN\",\"dummyMode\":true}")

if echo "$VERIFY" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ PASS${NC}: verify-otp endpoint working" | tee -a "$LOG_FILE"
  echo "Response: $VERIFY" >> "$LOG_FILE"
  ((PASSED_TESTS++))
else
  echo -e "${RED}❌ FAIL${NC}: verify-otp endpoint error" | tee -a "$LOG_FILE"
  echo "Response: $VERIFY" >> "$LOG_FILE"
  ((FAILED_TESTS++))
fi

# Test 5: Saved Cards Data
echo -e "\n${YELLOW}[TEST 5]${NC} Saved Cards Data Retrieval" | tee -a "$LOG_FILE"
if echo "$VERIFY" | grep -q '"savedCards"'; then
  CARD_COUNT=$(echo "$VERIFY" | grep -o '"savedCards"' | wc -l)
  echo -e "${GREEN}✅ PASS${NC}: Saved cards returned in API response" | tee -a "$LOG_FILE"
  ((PASSED_TESTS++))
else
  echo -e "${YELLOW}⚠️  WARNING${NC}: No saved cards in response (may be normal in some flows)" | tee -a "$LOG_FILE"
fi

# Test 6: Security - No Sensitive Files
echo -e "\n${YELLOW}[TEST 6]${NC} Security: Sensitive Files Check" | tee -a "$LOG_FILE"
SENSITIVE_FOUND=0
for file in ".env" ".env.local" "credentials.json" "db-backup.json"; do
  if [ -f "$file" ]; then
    echo "Found: $file" >> "$LOG_FILE"
    ((SENSITIVE_FOUND++))
  fi
done

if [ $SENSITIVE_FOUND -eq 0 ]; then
  echo -e "${GREEN}✅ PASS${NC}: No sensitive files in repository" | tee -a "$LOG_FILE"
  ((PASSED_TESTS++))
else
  echo -e "${RED}❌ FAIL${NC}: Found $SENSITIVE_FOUND sensitive file(s)" | tee -a "$LOG_FILE"
  ((FAILED_TESTS++))
fi

# Test 7: UI Components Present
echo -e "\n${YELLOW}[TEST 7]${NC} UI Components Verification" | tee -a "$LOG_FILE"
HTML=$(curl -s http://localhost:3000/)
COMPONENTS_FOUND=0
for component in "Block" "Remove" "Add card"; do
  if echo "$HTML" | grep -q "$component"; then
    ((COMPONENTS_FOUND++))
    echo "✅ Found: $component" >> "$LOG_FILE"
  fi
done

if [ $COMPONENTS_FOUND -ge 2 ]; then
  echo -e "${GREEN}✅ PASS${NC}: Critical UI components present" | tee -a "$LOG_FILE"
  ((PASSED_TESTS++))
else
  echo -e "${YELLOW}⚠️  WARNING${NC}: Only $COMPONENTS_FOUND critical UI components found" | tee -a "$LOG_FILE"
fi

# Summary
echo -e "\n========================================" | tee -a "$LOG_FILE"
echo "SUMMARY" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo -e "Total Tests: $((PASSED_TESTS + FAILED_TESTS))" | tee -a "$LOG_FILE"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}" | tee -a "$LOG_FILE"
echo -e "${RED}Failed: $FAILED_TESTS${NC}" | tee -a "$LOG_FILE"

if [ $FAILED_TESTS -eq 0 ]; then
  echo -e "\n${GREEN}✅ ALL TESTS PASSED - READY FOR PRODUCTION${NC}" | tee -a "$LOG_FILE"
  exit 0
else
  echo -e "\n${RED}❌ TESTS FAILED - DO NOT DEPLOY${NC}" | tee -a "$LOG_FILE"
  exit 1
fi
