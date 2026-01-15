#!/usr/bin/env bash
#
# Benchmark script for cmux startup time
# Measures time from process start to first render completion
#
# Usage:
#   ./scripts/benchmark.sh          # Run inside tmux (default 15 iterations)
#   ./scripts/benchmark.sh 20       # Run with custom iteration count
#   OUTSIDE_TMUX=1 ./scripts/benchmark.sh  # Run outside tmux (uses mock mode)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ITERATIONS="${1:-15}"

# Check if we're in tmux (unless OUTSIDE_TMUX is set for testing)
if [[ -z "${TMUX:-}" ]] && [[ -z "${OUTSIDE_TMUX:-}" ]]; then
    echo "Warning: Not running inside tmux. The app will use mock data."
    echo "For accurate benchmarks, run this inside a tmux session."
    echo ""
fi

# Collect timing data
declare -a times=()

echo "Benchmarking cmux startup time..."
echo "Iterations: $ITERATIONS"
echo ""

for i in $(seq 1 "$ITERATIONS"); do
    # Use bun's built-in performance timing via environment variable
    # The app exits immediately in benchmark mode after first render
    start_ns=$(date +%s%N)

    # Run the app in benchmark mode - it will exit after first render
    CMUX_BENCHMARK=1 bun "$PROJECT_DIR/src/main.ts" 2>/dev/null || true

    end_ns=$(date +%s%N)

    # Calculate duration in milliseconds
    duration_ns=$((end_ns - start_ns))
    duration_ms=$(echo "scale=2; $duration_ns / 1000000" | bc)

    times+=("$duration_ms")

    # Show progress
    printf "\r  Run %2d/%d: %6.2f ms" "$i" "$ITERATIONS" "$duration_ms"
done

echo ""
echo ""

# Calculate statistics
min=$(printf '%s\n' "${times[@]}" | sort -n | head -1)
max=$(printf '%s\n' "${times[@]}" | sort -n | tail -1)
sum=$(printf '%s\n' "${times[@]}" | awk '{sum+=$1} END {print sum}')
avg=$(echo "scale=2; $sum / $ITERATIONS" | bc)

# Calculate median
sorted=($(printf '%s\n' "${times[@]}" | sort -n))
mid=$((ITERATIONS / 2))
if ((ITERATIONS % 2 == 0)); then
    median=$(echo "scale=2; (${sorted[$mid-1]} + ${sorted[$mid]}) / 2" | bc)
else
    median="${sorted[$mid]}"
fi

# Calculate p95 (95th percentile)
p95_idx=$(echo "scale=0; $ITERATIONS * 0.95 / 1" | bc)
if ((p95_idx >= ITERATIONS)); then
    p95_idx=$((ITERATIONS - 1))
fi
p95="${sorted[$p95_idx]}"

echo "=== Benchmark Results ==="
echo ""
printf "  Min:    %6.2f ms\n" "$min"
printf "  Avg:    %6.2f ms\n" "$avg"
printf "  Median: %6.2f ms\n" "$median"
printf "  P95:    %6.2f ms\n" "$p95"
printf "  Max:    %6.2f ms\n" "$max"
echo ""

# Compare to target
target=23
if (( $(echo "$avg < $target" | bc -l) )); then
    echo "Status: PASS (avg ${avg}ms < target ${target}ms)"
else
    echo "Status: SLOW (avg ${avg}ms >= target ${target}ms)"
fi
