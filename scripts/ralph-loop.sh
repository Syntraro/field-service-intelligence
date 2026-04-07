#!/bin/bash
#
# Ralph Wiggum Loop - Autonomous Claude Code Runner
#
# Usage:
#   ./scripts/ralph-loop.sh                    # Run with defaults
#   ./scripts/ralph-loop.sh --max 10           # Limit to 10 iterations
#   ./scripts/ralph-loop.sh --prompt PROMPT.md # Use custom prompt file
#
# The loop runs until:
#   - Claude outputs "COMPLETE" or "BLOCKED"
#   - Max iterations reached
#   - Ctrl+C pressed
#

set -e

# Defaults
MAX_ITERATIONS=25
PROMPT_FILE="PROMPT.md"
DELAY_SECONDS=3
LOG_FILE="ralph-loop.log"
SKIP_PERMISSIONS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --max)
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --prompt)
      PROMPT_FILE="$2"
      shift 2
      ;;
    --delay)
      DELAY_SECONDS="$2"
      shift 2
      ;;
    --log)
      LOG_FILE="$2"
      shift 2
      ;;
    --yolo|--skip-permissions)
      SKIP_PERMISSIONS=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--max N] [--prompt FILE] [--delay SECONDS] [--log FILE] [--yolo]"
      echo ""
      echo "Options:"
      echo "  --max N            Maximum iterations (default: 25)"
      echo "  --prompt FILE      Prompt file to use (default: PROMPT.md)"
      echo "  --delay N          Seconds between iterations (default: 3)"
      echo "  --log FILE         Log file (default: ralph-loop.log)"
      echo "  --yolo             Skip permission prompts (use with caution!)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Check prompt file exists
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: Prompt file '$PROMPT_FILE' not found"
  echo "Create it first with your task instructions"
  exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Ralph Wiggum Loop - Starting${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Prompt file: ${YELLOW}$PROMPT_FILE${NC}"
echo -e "Max iterations: ${YELLOW}$MAX_ITERATIONS${NC}"
echo -e "Delay: ${YELLOW}${DELAY_SECONDS}s${NC}"
echo -e "Log file: ${YELLOW}$LOG_FILE${NC}"
if [[ "$SKIP_PERMISSIONS" == "true" ]]; then
  echo -e "Permissions: ${RED}SKIPPED (--yolo mode)${NC}"
fi
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop at any time${NC}"
echo ""

# Initialize log
echo "=== Ralph Loop Started: $(date) ===" > "$LOG_FILE"
echo "Prompt file: $PROMPT_FILE" >> "$LOG_FILE"
echo "Max iterations: $MAX_ITERATIONS" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Track start time for cost estimation
START_TIME=$(date +%s)

for i in $(seq 1 $MAX_ITERATIONS); do
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Iteration $i of $MAX_ITERATIONS${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  echo "=== Iteration $i - $(date) ===" >> "$LOG_FILE"

  # Read prompt and run Claude
  PROMPT_CONTENT=$(cat "$PROMPT_FILE")

  # Build Claude command
  CLAUDE_CMD="claude -p"
  if [[ "$SKIP_PERMISSIONS" == "true" ]]; then
    CLAUDE_CMD="claude --dangerously-skip-permissions -p"
  fi

  # Run Claude Code with the prompt
  # Using -p for print mode (non-interactive)
  # Capture both stdout and stderr
  OUTPUT=$($CLAUDE_CMD "$PROMPT_CONTENT" 2>&1) || true

  # Log output
  echo "$OUTPUT" >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"

  # Display output (truncated for readability)
  echo "$OUTPUT"

  # Check for completion signals (exact patterns to avoid false positives)
  # Look for signals on their own line or with specific markers
  if echo "$OUTPUT" | grep -qE "^COMPLETE$|COMPLETE[.:!]|<COMPLETE>|✓ COMPLETE|ALL TASKS COMPLETE"; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  ✓ COMPLETE - All tasks finished!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo "=== COMPLETE at $(date) ===" >> "$LOG_FILE"
    break
  fi

  if echo "$OUTPUT" | grep -qE "^BLOCKED:|BLOCKED[.:!]|<BLOCKED>"; then
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}  ✗ BLOCKED - Manual intervention needed${NC}"
    echo -e "${RED}========================================${NC}"
    echo "=== BLOCKED at $(date) ===" >> "$LOG_FILE"
    echo ""
    echo "Check the output above for details on what's blocking progress."
    break
  fi

  if echo "$OUTPUT" | grep -qiE "^HARD.STOP|HARD.STOP[.:!]|<HARD.STOP>|\*\*HARD.STOP\*\*"; then
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}  ⚠ HARD STOP - Verification required${NC}"
    echo -e "${YELLOW}========================================${NC}"
    echo "=== HARD STOP at $(date) ===" >> "$LOG_FILE"
    echo ""
    # Check if we have a TTY for interactive input
    if [ -t 0 ]; then
      read -p "Continue? (y/n): " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopped by user"
        break
      fi
    else
      echo "No TTY available - stopping for manual verification."
      echo "Review the HARD STOP output above, then re-run the loop to continue."
      break
    fi
  fi

  # Check if we're at max iterations
  if [[ $i -eq $MAX_ITERATIONS ]]; then
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}  Max iterations ($MAX_ITERATIONS) reached${NC}"
    echo -e "${YELLOW}========================================${NC}"
    echo "=== MAX ITERATIONS at $(date) ===" >> "$LOG_FILE"
    break
  fi

  # Delay before next iteration
  echo ""
  echo -e "${BLUE}Waiting ${DELAY_SECONDS}s before next iteration...${NC}"
  sleep "$DELAY_SECONDS"
done

# Summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Loop Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Total time: ${YELLOW}${MINUTES}m ${SECONDS}s${NC}"
echo -e "Iterations: ${YELLOW}$i${NC}"
echo -e "Log file: ${YELLOW}$LOG_FILE${NC}"
echo ""
echo "Review the log file for full output history."
