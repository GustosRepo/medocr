#!/bin/bash
# VLM Batch Test - Reprocess 32 documents through VLM pipeline

API_BASE="http://127.0.0.1:4387"
RESULTS_FILE="/tmp/vlm_test_results.json"

echo "Starting VLM batch test..."
echo "[]" > "$RESULTS_FILE"

# Get 32 most recent document IDs
DOC_IDS=$(curl -s "$API_BASE/api/documents" | jq -r '.items | sort_by(.createdAt) | reverse | .[0:32] | .[].id')

TOTAL=$(echo "$DOC_IDS" | wc -l | tr -d ' ')
COUNT=0

echo "Found $TOTAL documents to process"
echo ""

for ID in $DOC_IDS; do
    COUNT=$((COUNT + 1))
    echo "[$COUNT/$TOTAL] Processing $ID..."
    
    # Trigger reprocess
    START=$(date +%s)
    RESPONSE=$(curl -s -X POST "$API_BASE/api/documents/$ID/reprocess" \
        -H "Content-Type: application/json" \
        -d '{}')
    END=$(date +%s)
    DURATION=$((END - START))
    
    # Get result
    RESULT=$(curl -s "$API_BASE/api/documents/$ID/result")
    
    # Extract key fields
    PROVIDER=$(echo "$RESULT" | jq -r '.provider.name // "MISSING"')
    INSURANCE=$(echo "$RESULT" | jq -r '.insurance[0].carrier // "MISSING"')
    DOB=$(echo "$RESULT" | jq -r '.patient.dob // "MISSING"')
    DIAGNOSES=$(echo "$RESULT" | jq -r '.diagnoses | length')
    VLM_USED=$(echo "$RESULT" | jq -r '.extraction_method // "unknown"')
    
    echo "  Provider: $PROVIDER"
    echo "  Insurance: $INSURANCE" 
    echo "  DOB: $DOB"
    echo "  Diagnoses: $DIAGNOSES"
    echo "  Method: $VLM_USED"
    echo "  Time: ${DURATION}s"
    echo ""
    
    # Append to results
    jq --arg id "$ID" \
       --arg provider "$PROVIDER" \
       --arg insurance "$INSURANCE" \
       --arg dob "$DOB" \
       --arg diagnoses "$DIAGNOSES" \
       --arg method "$VLM_USED" \
       --arg time "$DURATION" \
       '. += [{"id": $id, "provider": $provider, "insurance": $insurance, "dob": $dob, "diagnoses": ($diagnoses | tonumber), "method": $method, "time": ($time | tonumber)}]' \
       "$RESULTS_FILE" > /tmp/vlm_temp.json && mv /tmp/vlm_temp.json "$RESULTS_FILE"
done

echo "============================================"
echo "SUMMARY"
echo "============================================"

# Calculate stats
PROVIDER_OK=$(jq '[.[] | select(.provider != "MISSING" and .provider != "" and .provider != "null")] | length' "$RESULTS_FILE")
INSURANCE_OK=$(jq '[.[] | select(.insurance != "MISSING" and .insurance != "" and .insurance != "null")] | length' "$RESULTS_FILE")
DOB_OK=$(jq '[.[] | select(.dob != "MISSING" and .dob != "" and .dob != "null")] | length' "$RESULTS_FILE")
DIAG_OK=$(jq '[.[] | select(.diagnoses > 0)] | length' "$RESULTS_FILE")
AVG_TIME=$(jq '[.[].time] | add / length | floor' "$RESULTS_FILE")
VLM_COUNT=$(jq '[.[] | select(.method | contains("vlm"))] | length' "$RESULTS_FILE")

echo "Provider extracted: $PROVIDER_OK / $TOTAL"
echo "Insurance extracted: $INSURANCE_OK / $TOTAL"
echo "DOB extracted: $DOB_OK / $TOTAL"
echo "Diagnoses extracted: $DIAG_OK / $TOTAL"
echo "VLM method used: $VLM_COUNT / $TOTAL"
echo "Average time: ${AVG_TIME}s per document"
echo ""
echo "Full results saved to: $RESULTS_FILE"
