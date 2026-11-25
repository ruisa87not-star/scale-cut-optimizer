#include <algorithm>
#include <cstddef>
#include <chrono>
#include <cmath>
#include <functional>
#include <iostream>
#include <limits>
#include <map>
#include <numeric>
#include <random>
#include <set>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

using Length = long long;

struct Bin {
    Length capacity{};
    Length used{};
    bool isOffcut{};
    std::vector<Length> items;
};

struct Metrics {
    int newRolls{};
    Length newRemainder{};
    Length deadScrapLength{};
    int deadScrapCount{};
    Length recoverableRemainder{};
    Length offcutConsumed{};
    int offcutsUsed{};
    int recoverableRemainderCount{};
    Length largestRecoverableRemainder{};
};

using Objective = std::tuple<int, Length, int, Length, Length, int, std::vector<Length>>;

template<typename StockBin>
std::vector<Length> concentratedTailScore(const std::vector<StockBin>& bins, Length threshold) {
    std::vector<Length> tails;
    for (const auto& bin : bins) {
        const auto remainder = bin.capacity - bin.used;
        if (bin.used && remainder > 0 && remainder >= threshold) tails.push_back(-remainder);
    }
    std::sort(tails.begin(), tails.end());
    return tails;
}

Length remaining(const Bin& bin) {
    return bin.capacity - bin.used;
}

Bin newBin(Length capacity) {
    return Bin{capacity, 0, false, {}};
}

Metrics metricsFor(const std::vector<Bin>& bins, Length threshold) {
    Metrics metrics;
    for (const auto& bin : bins) {
        if (bin.items.empty()) continue;
        const auto remainder = remaining(bin);
        if (bin.isOffcut) {
            metrics.offcutConsumed += bin.used;
            metrics.offcutsUsed++;
        } else {
            metrics.newRolls++;
            metrics.newRemainder += remainder;
        }
        if (remainder > 0 && remainder < threshold) {
            metrics.deadScrapLength += remainder;
            metrics.deadScrapCount++;
        }
        if (remainder > 0 && remainder >= threshold) {
            metrics.recoverableRemainder += remainder;
            ++metrics.recoverableRemainderCount;
            metrics.largestRecoverableRemainder = std::max(metrics.largestRecoverableRemainder, remainder);
        }
    }
    return metrics;
}

Objective objectiveFor(const std::vector<Bin>& bins, Length threshold, bool concentration = true) {
    const auto metrics = metricsFor(bins, threshold);
    return {
        metrics.newRolls,
        metrics.deadScrapLength,
        metrics.deadScrapCount,
        -metrics.offcutConsumed,
        metrics.newRemainder,
        concentration ? metrics.recoverableRemainderCount : 0,
        concentration ? concentratedTailScore(bins, threshold) : std::vector<Length>{},
    };
}

std::vector<Bin> buildBestFit(
    const std::vector<Length>& items,
    Length capacity,
    const std::vector<Length>& offcuts
) {
    std::vector<Bin> bins;
    for (const auto offcut : offcuts) bins.push_back(Bin{offcut, 0, true, {}});
    std::sort(bins.begin(), bins.end(), [](const Bin& left, const Bin& right) {
        return left.capacity > right.capacity;
    });

    auto sortedItems = items;
    std::sort(sortedItems.begin(), sortedItems.end(), std::greater<>());
    for (const auto item : sortedItems) {
        int target = -1;
        Length bestRemainder = std::numeric_limits<Length>::max();
        for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
            const auto after = remaining(bins[index]) - item;
            if (after < 0) continue;
            if (after < bestRemainder ||
                (target >= 0 && after == bestRemainder && bins[index].isOffcut && !bins[target].isOffcut)) {
                target = index;
                bestRemainder = after;
            }
        }
        if (target < 0) {
            bins.push_back(newBin(capacity));
            target = static_cast<int>(bins.size()) - 1;
        }
        bins[target].items.push_back(item);
        bins[target].used += item;
    }
    return bins;
}

void removeEmptyNewBins(std::vector<Bin>& bins) {
    bins.erase(std::remove_if(bins.begin(), bins.end(), [](const Bin& bin) {
        return !bin.isOffcut && bin.items.empty();
    }), bins.end());
}

bool tryEmptyNewRoll(std::vector<Bin>& bins, int sourceIndex, int nodeLimit = 12000) {
    auto& source = bins[sourceIndex];
    if (source.isOffcut || source.items.empty()) return false;

    auto pieces = source.items;
    std::sort(pieces.begin(), pieces.end(), std::greater<>());
    std::vector<int> destinations;
    for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
        if (index != sourceIndex) destinations.push_back(index);
    }
    int nodes = 0;
    std::function<bool(std::size_t)> place = [&](std::size_t pieceIndex) {
        if (++nodes > nodeLimit) return false;
        if (pieceIndex == pieces.size()) return true;
        const auto piece = pieces[pieceIndex];
        std::vector<int> choices;
        std::set<std::tuple<Length, Length, bool>> seen;
        for (const auto index : destinations) {
            const auto& target = bins[index];
            if (remaining(target) < piece) continue;
            const auto state = std::make_tuple(target.capacity, target.used, target.isOffcut);
            if (seen.insert(state).second) choices.push_back(index);
        }
        std::sort(choices.begin(), choices.end(), [&](int left, int right) {
            return remaining(bins[left]) - piece < remaining(bins[right]) - piece;
        });
        for (const auto index : choices) {
            auto& target = bins[index];
            target.items.push_back(piece);
            target.used += piece;
            if (place(pieceIndex + 1)) return true;
            target.items.pop_back();
            target.used -= piece;
        }
        return false;
    };

    if (!place(0)) return false;
    source.items.clear();
    source.used = 0;
    return true;
}

std::pair<int, int> improveMoves(std::vector<Bin>& bins, Length threshold, int maxSteps, bool concentration = true) {
    auto currentObjective = objectiveFor(bins, threshold, concentration);
    int moves = 0;
    for (int step = 0; step < maxSteps; ++step) {
        bool improved = false;
        const auto totalItems = std::accumulate(bins.begin(), bins.end(), 0ULL,
            [](unsigned long long total, const Bin& bin) { return total + bin.items.size(); });
        std::vector<int> sourceOrder(bins.size());
        std::iota(sourceOrder.begin(), sourceOrder.end(), 0);
        std::sort(sourceOrder.begin(), sourceOrder.end(), [&](int left, int right) {
            if (bins[left].isOffcut != bins[right].isOffcut) return !bins[left].isOffcut;
            return remaining(bins[left]) < remaining(bins[right]);
        });
        if (totalItems > 220 && sourceOrder.size() > 80) {
            // Retain the original bounded search, but never omit short-tail
            // sources merely because many full rolls precede them.
            const auto allSources = sourceOrder;
            sourceOrder.resize(80);
            for (std::size_t position = 80; position < allSources.size(); ++position) {
                const auto index = allSources[position];
                if (!bins[index].items.empty() && remaining(bins[index]) > 0 && remaining(bins[index]) < threshold)
                    sourceOrder.push_back(index);
            }
        }

        for (const auto sourceIndex : sourceOrder) {
            auto candidateItems = bins[sourceIndex].items;
            for (const auto item : candidateItems) {
                std::vector<int> targetOrder;
                for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
                    if (index != sourceIndex && remaining(bins[index]) >= item) targetOrder.push_back(index);
                }
                std::sort(targetOrder.begin(), targetOrder.end(), [&](int left, int right) {
                    const auto leftAfter = remaining(bins[left]) - item;
                    const auto rightAfter = remaining(bins[right]) - item;
                    if (leftAfter != rightAfter) return leftAfter < rightAfter;
                    return bins[left].isOffcut && !bins[right].isOffcut;
                });
                for (const auto targetIndex : targetOrder) {
                    auto& source = bins[sourceIndex];
                    auto& target = bins[targetIndex];
                    const auto sourceItem = std::find(source.items.begin(), source.items.end(), item);
                    if (sourceItem == source.items.end()) break;
                    const auto position = static_cast<std::size_t>(sourceItem - source.items.begin());
                    source.items.erase(sourceItem);
                    source.used -= item;
                    target.items.push_back(item);
                    target.used += item;
                    const auto candidateObjective = objectiveFor(bins, threshold, concentration);
                    if (candidateObjective < currentObjective) {
                        currentObjective = candidateObjective;
                        moves++;
                        improved = true;
                        break;
                    }
                    target.items.pop_back();
                    target.used -= item;
                    source.items.insert(source.items.begin() + position, item);
                    source.used += item;
                }
                if (improved) break;
            }
            if (improved) break;
        }
        if (!improved) break;
        removeEmptyNewBins(bins);
    }
    return {moves, 0};
}

struct SolveResult {
    std::vector<Bin> bins;
    std::vector<Bin> baseline;
    int moves{};
    int swaps{};
};

// Choose a whole roll's combination together, instead of committing to the
// largest next cut. Bounded knapsack is exact for each roll's fill; different
// pressure/tie-break profiles avoid consuming all useful short cuts early.
std::vector<Bin> buildSubsetFit(const std::vector<Length>& items, Length capacity,
                              const std::vector<Length>& offcuts, int profile) {
    Length scale = capacity;
    std::map<Length, int, std::greater<>> quantities;
    for (const auto length : items) { ++quantities[length]; scale = std::gcd(scale, length); }
    for (const auto length : offcuts) scale = std::gcd(scale, length);
    std::vector<Length> lengths;
    std::vector<int> counts;
    for (const auto& [length, count] : quantities) { lengths.push_back(length); counts.push_back(count); }
    const auto largestStock = std::max(capacity, offcuts.empty() ? Length{0} : *std::max_element(offcuts.begin(), offcuts.end()));
    if (largestStock / scale > 20000 || lengths.size() > 128) return {};
    std::mt19937 generator(0x5C41Eu + profile * 7919u);
    std::vector<double> preference(lengths.size());
    for (std::size_t index = 0; index < lengths.size(); ++index) {
        const double pressure = static_cast<double>(counts[index]) * lengths[index];
        preference[index] = profile % 4 == 0 ? pressure : profile % 4 == 1 ? lengths[index] :
            profile % 4 == 2 ? 1.0 / std::max(1, counts[index]) : 1.0;
        if (profile >= 4) preference[index] *= 0.25 + (generator() % 10000) / 5000.0;
    }
    const auto fill = [&](Bin& bin) {
        const auto units = static_cast<int>(bin.capacity / scale);
        struct State { double score{-std::numeric_limits<double>::infinity()}; std::vector<int> cuts; };
        std::vector<State> states(units + 1);
        states[0] = {0.0, std::vector<int>(lengths.size())};
        // Binary splitting enforces quantity bounds without expanding a large
        // order into thousands of individual knapsack items.
        for (std::size_t type = 0; type < lengths.size(); ++type) {
            auto count = std::min<Length>(counts[type], bin.capacity / lengths[type]);
            for (int bundle = 1; count > 0; bundle *= 2) {
                const int taken = static_cast<int>(std::min<Length>(bundle, count));
                count -= taken;
                const auto weight = static_cast<int>(lengths[type] / scale) * taken;
                for (int used = units; used >= weight; --used) {
                    const auto& previous = states[used - weight];
                    if (previous.cuts.empty()) continue;
                    const double score = previous.score + preference[type] * taken;
                    if (score > states[used].score) {
                        states[used] = {score, previous.cuts};
                        states[used].cuts[type] += taken;
                    }
                }
            }
        }
        int used = units;
        while (used && states[used].cuts.empty()) --used;
        if (!used) return false;
        for (std::size_t type = 0; type < lengths.size(); ++type) {
            const auto count = states[used].cuts[type];
            counts[type] -= count;
            for (int index = 0; index < count; ++index) bin.items.push_back(lengths[type]);
        }
        bin.used = used * scale;
        return true;
    };
    std::vector<Bin> bins;
    for (const auto stock : offcuts) bins.push_back({stock, 0, true, {}});
    std::vector<std::size_t> stockOrder(bins.size());
    std::iota(stockOrder.begin(), stockOrder.end(), 0);
    std::sort(stockOrder.begin(), stockOrder.end(), [&](auto left, auto right) {
        return profile % 2 ? bins[left].capacity > bins[right].capacity : bins[left].capacity < bins[right].capacity;
    });
    for (const auto index : stockOrder) fill(bins[index]);
    while (std::any_of(counts.begin(), counts.end(), [](int count) { return count > 0; })) {
        auto bin = newBin(capacity);
        if (!fill(bin)) return {};
        bins.push_back(std::move(bin));
    }
    return bins;
}

// Joint branch-and-bound for small orders and small cross-roll neighbourhoods.
// It can exchange several cuts at once, which one-way moves cannot do. Search
// is bounded; the incumbent remains valid even when the node limit is reached.
std::vector<Bin> repackSmall(const std::vector<Length>& items, Length capacity, Length threshold,
                            const std::vector<Length>& offcuts, const std::vector<Bin>& incumbent,
                            int nodeLimit = 180000, bool concentration = true) {
    if (items.size() > 36) return incumbent;
    auto best = incumbent;
    auto bestObjective = objectiveFor(best, threshold, concentration);
    auto pieces = items;
    std::sort(pieces.begin(), pieces.end(), std::greater<>());
    std::vector<Length> suffix(pieces.size() + 1);
    for (std::size_t index = pieces.size(); index-- > 0;) suffix[index] = suffix[index + 1] + pieces[index];
    std::vector<Bin> trial;
    for (const auto stock : offcuts) trial.push_back({stock, 0, true, {}});
    int nodes = 0;
    bool finished = false;
    const auto volumeBound = (suffix[0] + capacity - 1) / capacity;
    std::function<void(std::size_t, int)> search = [&](std::size_t position, int newRolls) {
        if (finished || ++nodes > nodeLimit) return;
        if (position == pieces.size()) {
            const auto score = objectiveFor(trial, threshold, concentration);
            if (score < bestObjective) { best = trial; bestObjective = score; }
            const auto tailBound = volumeBound * capacity > suffix[0] ? 1 : 0;
            if (offcuts.empty() && std::get<0>(bestObjective) == volumeBound && std::get<1>(bestObjective) == 0 &&
                (!concentration || std::get<5>(bestObjective) <= tailBound)) finished = true;
            return;
        }
        Length free = 0;
        for (const auto& bin : trial) free += remaining(bin);
        const auto additional = std::max<Length>(0, (suffix[position] - free + capacity - 1) / capacity);
        if (newRolls + additional > std::get<0>(bestObjective)) return;
        const auto piece = pieces[position];
        std::set<std::tuple<Length, Length, bool>> seen;
        for (std::size_t index = 0; index < trial.size(); ++index) {
            if (remaining(trial[index]) < piece) continue;
            if (!seen.emplace(trial[index].capacity, trial[index].used, trial[index].isOffcut).second) continue;
            trial[index].items.push_back(piece); trial[index].used += piece;
            search(position + 1, newRolls);
            trial[index].items.pop_back(); trial[index].used -= piece;
        }
        if (piece <= capacity && newRolls < std::get<0>(bestObjective)) {
            trial.push_back({capacity, piece, false, {piece}});
            search(position + 1, newRolls + 1);
            trial.pop_back();
        }
    };
    search(0, 0);
    removeEmptyNewBins(best);
    return best;
}

void improveAcrossRolls(std::vector<Bin>& bins, Length capacity, Length threshold, bool concentration = true) {
    int attempts = 0;
    for (int pass = 0; pass < 3; ++pass) {
        bool changed = false;
        std::vector<int> order(bins.size());
        std::iota(order.begin(), order.end(), 0);
        std::sort(order.begin(), order.end(), [&](int a, int b) { return remaining(bins[a]) > remaining(bins[b]); });
        if (order.size() > 24) order.resize(24);
        for (std::size_t a = 0; a < order.size() && !changed; ++a) {
            for (std::size_t b = a + 1; b < order.size() && !changed; ++b) {
                if (++attempts > 180) return;
                const int first = order[a], second = order[b];
                std::vector<Bin> region = {bins[first], bins[second]};
                std::vector<Length> pieces, stocks;
                for (const auto& bin : region) {
                    pieces.insert(pieces.end(), bin.items.begin(), bin.items.end());
                    if (bin.isOffcut) stocks.push_back(bin.capacity);
                }
                const auto repacked = repackSmall(pieces, capacity, threshold, stocks, region, 8000, concentration);
                if (objectiveFor(repacked, threshold, concentration) >= objectiveFor(region, threshold, concentration)) continue;
                auto candidate = bins;
                candidate.erase(candidate.begin() + std::max(first, second));
                candidate.erase(candidate.begin() + std::min(first, second));
                candidate.insert(candidate.end(), repacked.begin(), repacked.end());
                if (objectiveFor(candidate, threshold, concentration) < objectiveFor(bins, threshold, concentration)) {
                    bins = std::move(candidate); changed = true;
                }
            }
        }
        if (!changed) break;
    }
}

// Fill all but one stock in a small neighbourhood exactly. Work with counts
// of lengths, not permutations of individual cuts: many short pieces can be
// exchanged together without expanding the whole order's search space.
std::vector<Bin> repackWithSingleTail(const std::vector<Bin>& region,
                                    std::chrono::steady_clock::time_point deadline) {
    if (region.size() < 2 || region.size() > 12) return {};
    std::map<Length, int, std::greater<>> quantities;
    Length free = 0;
    int sink = -1;
    for (int index = 0; index < static_cast<int>(region.size()); ++index) {
        free += remaining(region[index]);
        for (const auto item : region[index].items) ++quantities[item];
        if (sink < 0 || (region[sink].isOffcut && !region[index].isOffcut) ||
            (region[sink].isOffcut == region[index].isOffcut && region[index].capacity > region[sink].capacity)) sink = index;
    }
    if (!free || free >= region[sink].capacity || quantities.size() > 12) return {};
    std::vector<Length> lengths;
    std::vector<int> counts;
    for (const auto& [length, count] : quantities) { lengths.push_back(length); counts.push_back(count); }
    std::vector<Length> suffixGcd(lengths.size() + 1);
    for (auto index = lengths.size(); index-- > 0;) suffixGcd[index] = std::gcd(lengths[index], suffixGcd[index + 1]);
    std::map<Length, std::vector<std::vector<int>>> patterns;
    int work = 0;
    bool stopped = false;
    const auto allowed = [&]() {
        if (++work > 60000 || ((work & 255) == 0 && std::chrono::steady_clock::now() >= deadline)) stopped = true;
        return !stopped;
    };
    const auto makePatterns = [&](Length target) {
        auto& rows = patterns[target];
        std::vector<int> pattern(lengths.size());
        std::function<void(std::size_t, Length)> enumerate = [&](std::size_t type, Length needed) {
            if (!allowed() || rows.size() >= 4000) { stopped = true; return; }
            if (needed % suffixGcd[type]) return;
            if (type + 1 == lengths.size()) {
                if (needed % lengths[type] == 0 && needed / lengths[type] <= counts[type]) {
                    pattern[type] = static_cast<int>(needed / lengths[type]); rows.push_back(pattern);
                }
                return;
            }
            const auto maximum = static_cast<int>(std::min<Length>(counts[type], needed / lengths[type]));
            for (int count = maximum; count >= 0 && !stopped; --count) {
                pattern[type] = count;
                enumerate(type + 1, needed - count * lengths[type]);
            }
        };
        enumerate(0, target);
    };
    std::vector<int> full;
    for (int index = 0; index < static_cast<int>(region.size()); ++index) {
        const auto target = region[index].capacity - (index == sink ? free : 0);
        if (!patterns.count(target)) makePatterns(target);
        if (stopped || patterns[target].empty()) return {};
        if (index != sink) full.push_back(index);
    }
    std::sort(full.begin(), full.end(), [&](int a, int b) { return region[a].capacity > region[b].capacity; });
    auto candidate = region;
    for (auto& bin : candidate) { bin.used = 0; bin.items.clear(); }
    const auto fits = [&](const auto& pattern) {
        for (std::size_t type = 0; type < counts.size(); ++type) if (pattern[type] > counts[type]) return false;
        return true;
    };
    const auto place = [&](int index, const auto& pattern) {
        auto& bin = candidate[index]; bin.items.clear(); bin.used = 0;
        for (std::size_t type = 0; type < counts.size(); ++type) {
            counts[type] -= pattern[type];
            for (int cut = 0; cut < pattern[type]; ++cut) bin.items.push_back(lengths[type]);
            bin.used += lengths[type] * pattern[type];
        }
    };
    const auto restore = [&](const auto& pattern) {
        for (std::size_t type = 0; type < counts.size(); ++type) counts[type] += pattern[type];
    };
    std::set<std::vector<int>> failed;
    std::function<bool(std::size_t)> fill = [&](std::size_t position) {
        if (!allowed()) return false;
        if (position == full.size()) return std::all_of(counts.begin(), counts.end(), [](int count) { return count == 0; });
        auto key = counts; key.push_back(static_cast<int>(position));
        if (failed.count(key)) return false;
        Length divisor = 0;
        for (std::size_t type = 0; type < counts.size(); ++type) if (counts[type]) divisor = std::gcd(divisor, lengths[type]);
        const auto index = full[position];
        if (!divisor || region[index].capacity % divisor) return false;
        for (const auto& pattern : patterns[region[index].capacity]) {
            if (stopped) return false;
            if (!fits(pattern)) continue;
            place(index, pattern);
            if (fill(position + 1)) return true;
            restore(pattern);
        }
        failed.insert(std::move(key));
        return false;
    };
    for (const auto& pattern : patterns[region[sink].capacity - free]) {
        if (stopped) break;
        place(sink, pattern);
        if (fill(0)) return candidate;
        restore(pattern);
    }
    return {};
}

void concentrateRemainders(std::vector<Bin>& bins, Length threshold, int milliseconds = 1500) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(milliseconds);
    for (int pass = 0; pass < 12 && std::chrono::steady_clock::now() < deadline; ++pass) {
        std::vector<int> tails, donors;
        std::set<std::tuple<Length, bool, std::vector<Length>>> seen;
        for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
            if (!bins[index].used) continue;
            if (remaining(bins[index])) tails.push_back(index);
            else {
                auto cuts = bins[index].items; std::sort(cuts.begin(), cuts.end());
                if (seen.emplace(bins[index].capacity, bins[index].isOffcut, std::move(cuts)).second) donors.push_back(index);
            }
        }
        if (tails.size() < 2) return;
        std::sort(tails.begin(), tails.end(), [&](int a, int b) { return remaining(bins[a]) < remaining(bins[b]); });
        Length largestStock = 0, free = 0;
        for (const auto& bin : bins) if (bin.used) largestStock = std::max(largestStock, bin.capacity);
        std::vector<int> neighbourhood;
        for (const auto index : tails) {
            if (neighbourhood.size() == 10 || free + remaining(bins[index]) >= largestStock) break;
            neighbourhood.push_back(index); free += remaining(bins[index]);
        }
        tails = std::move(neighbourhood);
        if (tails.size() < 2) return;
        if (donors.size() > 20) donors.resize(20);
        bool improved = false;
        const auto attempt = [&](const std::vector<int>& indices, auto limit) {
            if (std::chrono::steady_clock::now() >= limit) return false;
            std::vector<Bin> region;
            for (const auto index : indices) region.push_back(bins[index]);
            const auto repacked = repackWithSingleTail(region, limit);
            if (repacked.empty()) return false;
            auto candidate = bins;
            for (std::size_t index = 0; index < indices.size(); ++index) candidate[indices[index]] = repacked[index];
            if (objectiveFor(candidate, threshold) >= objectiveFor(bins, threshold)) return false;
            bins = std::move(candidate);
            return true;
        };
        // A full roll can supply a missing length/residue class. Its cuts are
        // exchanged, never consumed twice or discarded to manufacture a tail.
        const auto searchGroup = [&](const std::vector<int>& group, auto limit) {
            if (attempt(group, limit)) return true;
            for (const auto donor : donors) {
                auto region = group; region.push_back(donor);
                if (attempt(region, limit)) return true;
            }
            for (std::size_t first = 0; first < donors.size(); ++first) {
                for (std::size_t second = first + 1; second < donors.size(); ++second) {
                    if (std::chrono::steady_clock::now() >= limit) return false;
                    auto region = group; region.push_back(donors[first]); region.push_back(donors[second]);
                    if (attempt(region, limit)) return true;
                }
            }
            return false;
        };
        improved = searchGroup(tails, std::min(deadline, std::chrono::steady_clock::now() + std::chrono::milliseconds(450)));
        // If one tail is infeasible, close a smaller group instead. Do not
        // leave every fragment untouched merely because the full merge fails.
        for (std::size_t count = tails.size() - 1; count >= 2 && !improved; --count) {
            for (std::size_t start = 0; start + count <= tails.size() && start < 4 && !improved; ++start) {
                if (std::chrono::steady_clock::now() >= deadline) return;
                std::vector<int> group(tails.begin() + start, tails.begin() + start + count);
                improved = searchGroup(group, std::min(deadline, std::chrono::steady_clock::now() + std::chrono::milliseconds(200)));
            }
        }
        if (!improved) return;
    }
}

SolveResult solve(
    const std::vector<Length>& items,
    Length capacity,
    Length threshold,
    const std::vector<Length>& offcuts
) {
    auto bins = buildBestFit(items, capacity, offcuts);
    int rollRemovals = 0;
    while (true) {
        std::vector<int> candidates;
        for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
            if (!bins[index].isOffcut && !bins[index].items.empty()) candidates.push_back(index);
        }
        std::sort(candidates.begin(), candidates.end(), [&](int left, int right) {
            if (bins[left].used != bins[right].used) return bins[left].used < bins[right].used;
            return bins[left].items.size() < bins[right].items.size();
        });
        bool removed = false;
        for (const auto index : candidates) {
            if (tryEmptyNewRoll(bins, index)) {
                removeEmptyNewBins(bins);
                rollRemovals++;
                removed = true;
                break;
            }
        }
        if (!removed) break;
    }
    // Keep the fully improved legacy solution as the incumbent, not merely
    // its initial greedy placement. New searches must never discard a better
    // scrap result that the existing single-cut moves can already achieve.
    const auto totalItems = items.size();
    const auto [initialMoves, initialSwaps] = improveMoves(bins, threshold, totalItems <= 220 ? 160 : 50, false);
    const auto legacyStarted = std::chrono::steady_clock::now();
    const auto volumeBound = (std::accumulate(items.begin(), items.end(), Length{0}) + capacity - 1) / capacity;
    // Finish the prior scoring path first, including its cross-roll exchanges.
    // Concentration is an additional objective, not permission to lose a
    // better roll/scrap/inventory result reached by that path.
    for (int profile = 0; profile < 64; ++profile) {
        auto candidate = buildSubsetFit(items, capacity, offcuts, profile);
        if (candidate.empty()) continue;
        if (objectiveFor(candidate, threshold, false) < objectiveFor(bins, threshold, false)) bins = std::move(candidate);
        const auto metrics = metricsFor(bins, threshold);
        if (offcuts.empty() && metrics.newRolls == volumeBound && metrics.deadScrapLength == 0) break;
        if (std::chrono::steady_clock::now() - legacyStarted > std::chrono::seconds(2)) break;
    }
    bins = repackSmall(items, capacity, threshold, offcuts, bins, 180000, false);
    const auto legacyMetrics = metricsFor(bins, threshold);
    if (!offcuts.empty() || legacyMetrics.newRolls > volumeBound || legacyMetrics.deadScrapLength)
        improveAcrossRolls(bins, capacity, threshold, false);
    const auto [legacyMoves, legacySwaps] = improveMoves(bins, threshold, totalItems <= 220 ? 160 : 50, false);
    const auto before = bins;
    const auto started = std::chrono::steady_clock::now();
    for (int profile = 0; profile < 64; ++profile) {
        auto candidate = buildSubsetFit(items, capacity, offcuts, profile);
        if (candidate.empty()) continue;
        if (objectiveFor(candidate, threshold) < objectiveFor(bins, threshold)) bins = std::move(candidate);
        const auto metrics = metricsFor(bins, threshold);
        const auto tailBound = volumeBound * capacity > std::accumulate(items.begin(), items.end(), Length{0}) ? 1 : 0;
        if (offcuts.empty() && metrics.newRolls == volumeBound && metrics.deadScrapLength == 0 &&
            metrics.recoverableRemainderCount <= tailBound) break;
        if (std::chrono::steady_clock::now() - started > std::chrono::seconds(2)) break;
    }
    bins = repackSmall(items, capacity, threshold, offcuts, bins);
    const auto bestMetrics = metricsFor(bins, threshold);
    if (!offcuts.empty() || bestMetrics.newRolls > volumeBound || bestMetrics.deadScrapLength ||
        bestMetrics.recoverableRemainderCount > 1) improveAcrossRolls(bins, capacity, threshold);
    const auto [moves, swaps] = improveMoves(bins, threshold, totalItems <= 220 ? 160 : 50);
    concentrateRemainders(bins, threshold);
    const auto baseline = offcuts.empty() ? bins : solve(items, capacity, threshold, {}).bins;
    return {bins, baseline, moves + initialMoves + legacyMoves + rollRemovals,
        swaps + initialSwaps + legacySwaps + (objectiveFor(bins, threshold) < objectiveFor(before, threshold) ? 1 : 0)};
}

struct SectionBin {
    Length capacitySections{};
    Length pairedSections{};
    Length regularSections{};
    bool isOffcut{};
    Length fullSections{};
    std::map<std::pair<Length, Length>, Length> pairDetails;
    std::map<Length, Length> singleDetails;
};

Length usedSections(const SectionBin& bin) {
    return bin.pairedSections + bin.regularSections;
}

Length availableMiddleSections(const SectionBin& bin) {
    return std::max(Length{0}, bin.capacitySections - 2) - bin.pairedSections;
}

struct PairingPlan {
    Length fullSections{};
    Length pairedSections{};
    Length singleSections{};
    Length scrapLength{};
    std::vector<std::tuple<Length, Length, Length>> pairs;
    std::map<Length, Length> singles;
};

struct SectionResult {
    std::vector<SectionBin> bins;
    std::vector<SectionBin> baseline;
    PairingPlan plan;
};

std::vector<SectionBin> placeSectionPlan(
    const PairingPlan& plan,
    Length rollSections,
    const std::vector<Length>& offcuts,
    Length sectionSize
) {
    std::vector<SectionBin> bins;
    for (const auto offcut : offcuts) {
        const auto sections = offcut / sectionSize;
        if (sections > 0) bins.push_back({sections, 0, 0, true});
    }
    std::sort(bins.begin(), bins.end(), [](const SectionBin& left, const SectionBin& right) {
        return left.capacitySections > right.capacitySections;
    });

    auto findTarget = [&](bool middleOnly) {
        int target = -1;
        Length smallestRemainder = std::numeric_limits<Length>::max();
        for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
            auto& bin = bins[index];
            if (usedSections(bin) >= bin.capacitySections) continue;
            if (middleOnly && availableMiddleSections(bin) <= 0) continue;
            const auto remainderAfter = bin.capacitySections - usedSections(bin) - 1;
            if (remainderAfter < smallestRemainder ||
                (target >= 0 && remainderAfter == smallestRemainder && bin.isOffcut && !bins[target].isOffcut)) {
                target = index;
                smallestRemainder = remainderAfter;
            }
        }
        if (target < 0) {
            if (middleOnly && rollSections < 3) throw std::runtime_error("新卷至少需要 3 節，才能在中間進行端段對接。");
            bins.push_back({rollSections, 0, 0, false});
            target = static_cast<int>(bins.size()) - 1;
        }
        return target;
    };
    for (const auto& [left, right, count] : plan.pairs) {
        for (Length item = 0; item < count; ++item) {
            const auto target = findTarget(true);
            bins[target].pairedSections++;
            bins[target].pairDetails[{left, right}]++;
        }
    }
    for (const auto& [value, count] : plan.singles) {
        for (Length item = 0; item < count; ++item) {
            const auto target = findTarget(false);
            bins[target].regularSections++;
            bins[target].singleDetails[value]++;
        }
    }
    for (Length item = 0; item < plan.fullSections; ++item) {
        const auto target = findTarget(false);
        bins[target].regularSections++;
        bins[target].fullSections++;
    }
    return bins;
}

Metrics metricsForSections(
    const std::vector<SectionBin>& bins,
    Length sectionSize,
    Length threshold,
    Length pairingScrap,
    Length singleSections
) {
    Metrics metrics;
    for (const auto& bin : bins) {
        const auto used = usedSections(bin);
        if (!used) continue;
        const auto remainder = (bin.capacitySections - used) * sectionSize;
        if (bin.isOffcut) {
            metrics.offcutConsumed += used * sectionSize;
            metrics.offcutsUsed++;
        } else {
            metrics.newRolls++;
            metrics.newRemainder += remainder;
        }
        if (remainder > 0 && remainder < threshold) {
            metrics.deadScrapLength += remainder;
            metrics.deadScrapCount++;
        }
        if (remainder > 0 && remainder >= threshold) {
            metrics.recoverableRemainder += remainder;
            ++metrics.recoverableRemainderCount;
            metrics.largestRecoverableRemainder = std::max(metrics.largestRecoverableRemainder, remainder);
        }
    }
    metrics.deadScrapLength += pairingScrap;
    metrics.deadScrapCount += static_cast<int>(singleSections);
    return metrics;
}

SectionResult solveSections(
    const std::vector<std::tuple<Length, int, Length, Length>>& orders,
    Length capacity,
    Length sectionSize,
    const std::vector<Length>& offcuts
) {
    if (capacity % sectionSize != 0) throw std::runtime_error("節距模式下，新卷標準長度必須是節距的整數倍。");
    for (const auto offcut : offcuts) {
        if (offcut % sectionSize != 0) {
            throw std::runtime_error("節距模式下，現有餘料長度必須是節距的整數倍。");
        }
    }
    const auto rollSections = capacity / sectionSize;
    std::map<Length, Length> startEndpoints;
    std::map<Length, Length> endEndpoints;
    PairingPlan plan;
    for (const auto& [length, quantity, start, end] : orders) {
        if (!start && !end) {
            if (length % sectionSize != 0) {
                throw std::runtime_error("非節距整數倍的訂單，請輸入特殊規格，例如 160-30/30。");
            }
            plan.fullSections += (length / sectionSize) * quantity;
            continue;
        }
        if (!start || !end || start >= sectionSize || end >= sectionSize || length < start + end ||
            (length - start - end) % sectionSize != 0) {
            throw std::runtime_error("特殊規格必須符合：長度 - 起始節段 - 結束節段 = 節距的整數倍。");
        }
        plan.fullSections += ((length - start - end) / sectionSize) * quantity;
        startEndpoints[start] += quantity;
        endEndpoints[end] += quantity;
    }
    for (auto& [value, count] : endEndpoints) {
        const auto complement = sectionSize - value;
        auto complementIt = startEndpoints.find(complement);
        if (complementIt == startEndpoints.end()) continue;
        const auto pairs = std::min(count, complementIt->second);
        if (!pairs) continue;
        count -= pairs;
        complementIt->second -= pairs;
        plan.pairedSections += pairs;
        plan.pairs.emplace_back(value, complement, pairs);
    }
    for (const auto& [value, count] : startEndpoints) {
        if (!count) continue;
        plan.singles[value] += count;
        plan.singleSections += count;
        plan.scrapLength += (sectionSize - value) * count;
    }
    for (const auto& [value, count] : endEndpoints) {
        if (!count) continue;
        plan.singles[value] += count;
        plan.singleSections += count;
        plan.scrapLength += (sectionSize - value) * count;
    }
    return {
        placeSectionPlan(plan, rollSections, offcuts, sectionSize),
        placeSectionPlan(plan, rollSections, {}, sectionSize),
        plan,
    };
}

// A pitch item is not just its finished length.  For example, 940-20/20 has
// two partial 20 mm ends.  They only share a 50 mm section when they are
// immediately adjacent to a complementary 30 mm end in the same roll.
// RecipeBlock keeps that physical sequence together so the bin packer cannot
// place a mathematically short, but physically impossible, combination.
struct LayoutSegment {
    Length length{};
    bool isEdgeScrap{};
};

struct RecipeSequence {
    std::vector<Length> items;
    Length leftScrap{};
    Length rightScrap{};
};

struct RecipeBlock {
    std::vector<Length> items;
    std::vector<std::pair<Length, Length>> joins;
    std::vector<Length> exposedEnds;
    // A filled recipe may contain a special chain followed by ordinary cuts.
    // Keep its physical order separate from the product summary so the
    // visual layout always places the 20/30 end fillers in the right spot.
    std::vector<RecipeSequence> sequences;
    std::vector<LayoutSegment> layout;
    Length productLength{};
    Length physicalLength{};
    Length edgeScrap{};
    Length fullSections{};
};

struct RecipeBin {
    Length capacity{};
    Length used{};
    bool isOffcut{};
    std::vector<RecipeBlock> blocks;
};

struct RecipeResult {
    std::vector<RecipeBin> bins;
    std::vector<RecipeBin> baseline;
    PairingPlan plan;
};

struct SpecialSpec {
    Length length{};
    int quantity{};
    Length start{};
    Length end{};
};

RecipeBlock normalBlock(Length length, Length sectionSize) {
    RecipeBlock block;
    block.items = {length};
    block.layout = {{length, false}};
    block.productLength = length;
    block.physicalLength = length;
    block.fullSections = length / sectionSize;
    return block;
}

RecipeBlock sequenceBlock(
    const std::vector<const SpecialSpec*>& sequence,
    Length sectionSize
) {
    RecipeBlock block;
    if (sequence.empty()) return block;
    for (const auto* item : sequence) {
        block.items.push_back(item->length);
        block.productLength += item->length;
        block.fullSections += (item->length - item->start - item->end) / sectionSize;
    }
    for (std::size_t index = 1; index < sequence.size(); ++index) {
        const auto* left = sequence[index - 1];
        const auto* right = sequence[index];
        if (left->end + right->start != sectionSize) {
            throw std::runtime_error("Internal pitch sequence has a non-complementary join.");
        }
        block.joins.emplace_back(left->end, right->start);
    }
    block.exposedEnds = {sequence.front()->start, sequence.back()->end};
    const auto leftScrap = sectionSize - sequence.front()->start;
    const auto rightScrap = sectionSize - sequence.back()->end;
    block.edgeScrap = leftScrap + rightScrap;
    block.physicalLength = block.productLength + block.edgeScrap;
    block.sequences.push_back({block.items, leftScrap, rightScrap});
    block.layout.push_back({leftScrap, true});
    for (const auto item : block.items) block.layout.push_back({item, false});
    block.layout.push_back({rightScrap, true});
    return block;
}

// Combine a complementary special chain with ordinary items that exactly fill
// the rest of a roll.  It stays atomic during bin packing: this preserves the
// recipe discovered by the optimiser and avoids later BFD moves breaking a
// deliberately perfect 5,000 mm layout.
RecipeBlock fillRecipeBlock(RecipeBlock specialBlock, const std::vector<Length>& filler, Length sectionSize) {
    for (const auto item : filler) {
        specialBlock.items.push_back(item);
        specialBlock.layout.push_back({item, false});
        specialBlock.productLength += item;
        specialBlock.physicalLength += item;
        specialBlock.fullSections += item / sectionSize;
    }
    return specialBlock;
}

struct AlternatingPattern {
    int firstCount{};
    int secondCount{};
    bool firstStarts{};
};

bool makeExactComplementaryBlocks(
    const std::vector<SpecialSpec>& special,
    Length maximumBlockLength,
    Length sectionSize,
    std::vector<RecipeBlock>& blocks
) {
    if (special.size() != 2) return false;
    const auto& first = special[0];
    const auto& second = special[1];
    if (first.start != first.end || second.start != second.end || first.start + second.start != sectionSize) return false;

    const auto firstCount = first.quantity;
    const auto secondCount = second.quantity;
    // This dynamic program selects complete alternating chains which fit in a
    // roll.  It minimises exposed end waste before the ordinary bin packing
    // combines those chains with normal products.
    if (static_cast<long long>(firstCount + 1) * static_cast<long long>(secondCount + 1) > 1'000'000) return false;

    std::vector<AlternatingPattern> patterns;
    const auto addPattern = [&](int firstItems, int secondItems, bool firstStarts) {
        if (firstItems < 0 || secondItems < 0 || std::abs(firstItems - secondItems) > 1 || (!firstItems && !secondItems)) return;
        if ((firstItems > secondItems && !firstStarts) || (secondItems > firstItems && firstStarts)) return;
        const auto startsWithFirst = firstStarts;
        const auto endsWithFirst = firstItems > secondItems || (firstItems == secondItems && !startsWithFirst);
        const auto start = startsWithFirst ? first.start : second.start;
        const auto end = endsWithFirst ? first.end : second.end;
        const auto product = first.length * firstItems + second.length * secondItems;
        const auto physical = product + (sectionSize - start) + (sectionSize - end);
        if (physical <= maximumBlockLength) patterns.push_back({firstItems, secondItems, firstStarts});
    };
    const auto maxItems = std::min<Length>(maximumBlockLength / std::max<Length>(1, std::min(first.length, second.length)) + 1,
                                           std::max(firstCount, secondCount) + 1);
    for (int count = 0; count <= maxItems; ++count) {
        addPattern(count + 1, count, true);
        addPattern(count, count + 1, false);
        if (count > 0) {
            addPattern(count, count, true);
            addPattern(count, count, false);
        }
    }
    if (patterns.empty()) return false;

    struct State {
        Length scrap{std::numeric_limits<Length>::max()};
        int chains{std::numeric_limits<int>::max()};
        int previousFirst{-1};
        int previousSecond{-1};
        int pattern{-1};
    };
    const auto width = secondCount + 1;
    std::vector<State> states(static_cast<std::size_t>(firstCount + 1) * width);
    const auto at = [&](int firstItems, int secondItems) -> State& {
        return states[static_cast<std::size_t>(firstItems) * width + secondItems];
    };
    at(0, 0).scrap = 0;
    at(0, 0).chains = 0;
    for (int usedFirst = 0; usedFirst <= firstCount; ++usedFirst) {
        for (int usedSecond = 0; usedSecond <= secondCount; ++usedSecond) {
            const auto current = at(usedFirst, usedSecond);
            if (current.scrap == std::numeric_limits<Length>::max()) continue;
            for (int patternIndex = 0; patternIndex < static_cast<int>(patterns.size()); ++patternIndex) {
                const auto& pattern = patterns[patternIndex];
                const auto nextFirst = usedFirst + pattern.firstCount;
                const auto nextSecond = usedSecond + pattern.secondCount;
                if (nextFirst > firstCount || nextSecond > secondCount) continue;
                const auto& starts = pattern.firstStarts ? first : second;
                const auto endsWithFirst = pattern.firstCount > pattern.secondCount ||
                    (pattern.firstCount == pattern.secondCount && !pattern.firstStarts);
                const auto& ends = endsWithFirst ? first : second;
                const auto nextScrap = current.scrap + (sectionSize - starts.start) + (sectionSize - ends.end);
                auto& target = at(nextFirst, nextSecond);
                if (nextScrap < target.scrap || (nextScrap == target.scrap && current.chains + 1 < target.chains)) {
                    target = {nextScrap, current.chains + 1, usedFirst, usedSecond, patternIndex};
                }
            }
        }
    }
    if (at(firstCount, secondCount).pattern < 0) return false;

    std::vector<AlternatingPattern> selected;
    for (auto usedFirst = firstCount, usedSecond = secondCount; usedFirst || usedSecond;) {
        const auto& state = at(usedFirst, usedSecond);
        selected.push_back(patterns[state.pattern]);
        usedFirst = state.previousFirst;
        usedSecond = state.previousSecond;
    }
    std::reverse(selected.begin(), selected.end());
    for (const auto& pattern : selected) {
        int remainingFirst = pattern.firstCount;
        int remainingSecond = pattern.secondCount;
        bool useFirst = pattern.firstStarts;
        std::vector<const SpecialSpec*> sequence;
        while (remainingFirst || remainingSecond) {
            if (useFirst) {
                if (!remainingFirst) throw std::runtime_error("Invalid alternating pitch pattern.");
                sequence.push_back(&first);
                --remainingFirst;
            } else {
                if (!remainingSecond) throw std::runtime_error("Invalid alternating pitch pattern.");
                sequence.push_back(&second);
                --remainingSecond;
            }
            useFirst = !useFirst;
        }
        blocks.push_back(sequenceBlock(sequence, sectionSize));
    }
    return true;
}

std::vector<RecipeBlock> makeGreedyPitchBlocks(
    const std::vector<SpecialSpec>& special,
    Length capacity,
    Length sectionSize
) {
    auto remaining = special;
    std::vector<RecipeBlock> blocks;
    const auto outstanding = [&]() {
        return std::any_of(remaining.begin(), remaining.end(), [](const auto& item) { return item.quantity > 0; });
    };
    while (outstanding()) {
        int startIndex = -1;
        for (int index = 0; index < static_cast<int>(remaining.size()); ++index) {
            if (remaining[index].quantity <= 0) continue;
            if (startIndex < 0 || remaining[index].length > remaining[startIndex].length) startIndex = index;
        }
        std::vector<const SpecialSpec*> sequence = {&remaining[startIndex]};
        --remaining[startIndex].quantity;
        while (true) {
            const auto* last = sequence.back();
            int nextIndex = -1;
            for (int index = 0; index < static_cast<int>(remaining.size()); ++index) {
                if (remaining[index].quantity <= 0 || last->end + remaining[index].start != sectionSize) continue;
                auto candidate = sequence;
                candidate.push_back(&remaining[index]);
                const auto candidateBlock = sequenceBlock(candidate, sectionSize);
                if (candidateBlock.physicalLength > capacity) continue;
                if (nextIndex < 0 || remaining[index].length > remaining[nextIndex].length) nextIndex = index;
            }
            if (nextIndex < 0) break;
            sequence.push_back(&remaining[nextIndex]);
            --remaining[nextIndex].quantity;
        }
        blocks.push_back(sequenceBlock(sequence, sectionSize));
    }
    return blocks;
}

struct NormalSpec {
    Length length{};
    int quantity{};
};

struct ComplementaryPattern {
    int firstCount{};
    int secondCount{};
    bool firstStarts{};
    RecipeBlock block;
};

// All legal alternating chains for a complementary pair that can fit in one
// stock roll.  A chain may later be combined with normal products to form an
// exact 5,000 mm recipe.
std::vector<ComplementaryPattern> complementaryPatterns(
    const SpecialSpec& first,
    const SpecialSpec& second,
    Length capacity,
    Length sectionSize
) {
    std::vector<ComplementaryPattern> patterns;
    if (first.start != first.end || second.start != second.end || first.start + second.start != sectionSize) return patterns;
    const auto maxItems = capacity / std::max<Length>(1, std::min(first.length, second.length)) + 1;
    const auto add = [&](int firstItems, int secondItems, bool firstStarts) {
        if (!firstItems && !secondItems) return;
        if (std::abs(firstItems - secondItems) > 1) return;
        if ((firstItems > secondItems && !firstStarts) || (secondItems > firstItems && firstStarts)) return;
        int remainingFirst = firstItems;
        int remainingSecond = secondItems;
        bool useFirst = firstStarts;
        std::vector<const SpecialSpec*> sequence;
        while (remainingFirst || remainingSecond) {
            if (useFirst) {
                if (!remainingFirst) return;
                sequence.push_back(&first);
                --remainingFirst;
            } else {
                if (!remainingSecond) return;
                sequence.push_back(&second);
                --remainingSecond;
            }
            useFirst = !useFirst;
        }
        const auto block = sequenceBlock(sequence, sectionSize);
        if (block.physicalLength <= capacity) patterns.push_back({firstItems, secondItems, firstStarts, block});
    };
    for (int count = 0; count <= maxItems; ++count) {
        add(count + 1, count, true);
        add(count, count + 1, false);
        if (count > 0) {
            add(count, count, true);
            add(count, count, false);
        }
    }
    return patterns;
}

// Return a bounded, diverse list of exact normal-product fillers.  The stock
// pitch is small (normally 50 mm), so this search is fast while still finding
// combinations such as 950 + 700 and 1,000 + 800.
std::vector<std::vector<int>> exactNormalFills(
    const std::vector<NormalSpec>& normal,
    Length target,
    std::size_t limit = 512
) {
    std::vector<std::vector<int>> fills;
    if (target < 0) return fills;
    std::vector<int> order(normal.size());
    std::iota(order.begin(), order.end(), 0);
    std::sort(order.begin(), order.end(), [&](int left, int right) {
        return normal[left].length > normal[right].length;
    });
    std::vector<int> current(normal.size());
    std::function<void(std::size_t, Length)> search = [&](std::size_t position, Length remainingLength) {
        if (fills.size() >= limit) return;
        if (!remainingLength) {
            fills.push_back(current);
            return;
        }
        if (position == order.size()) return;
        const auto index = order[position];
        const auto maxCount = std::min<Length>(normal[index].quantity, remainingLength / normal[index].length);
        for (auto count = maxCount; count >= 0; --count) {
            current[index] = static_cast<int>(count);
            search(position + 1, remainingLength - count * normal[index].length);
            if (fills.size() >= limit) break;
        }
        current[index] = 0;
    };
    search(0, target);
    const auto pieceCount = [](const std::vector<int>& fill) {
        return std::accumulate(fill.begin(), fill.end(), 0);
    };
    std::sort(fills.begin(), fills.end(), [&](const auto& left, const auto& right) {
        const auto leftPieces = pieceCount(left);
        const auto rightPieces = pieceCount(right);
        if (leftPieces != rightPieces) return leftPieces < rightPieces;
        return left < right;
    });
    return fills;
}

std::vector<RecipeBlock> normalBlocksFor(const std::vector<NormalSpec>& normal, Length sectionSize) {
    std::vector<RecipeBlock> blocks;
    for (const auto& item : normal) {
        for (int count = 0; count < item.quantity; ++count) blocks.push_back(normalBlock(item.length, sectionSize));
    }
    return blocks;
}

struct FilledRecipeConstruction {
    std::vector<RecipeBlock> blocks;
    std::vector<SpecialSpec> remainingSpecial;
    std::vector<NormalSpec> remainingNormal;
};

// Greedily reserve exact full-roll recipes before generic BFD runs.  Several
// scoring profiles are evaluated by solveRecipe; this gives the optimiser a
// chance to choose between, for example, 4×940 + 3×160 + 700 and
// 3×940 + 3×160 + 950 + 700 rather than committing to one chain shape first.
FilledRecipeConstruction makeFilledRecipeConstruction(
    std::vector<SpecialSpec> special,
    std::vector<NormalSpec> normal,
    Length capacity,
    Length sectionSize,
    int profile
) {
    FilledRecipeConstruction construction;
    if (special.size() != 2) return {construction.blocks, special, normal};
    const int edgeWeight[] = {45, 65, 85, 110, 150, 210, 300, 420};
    const int fillerWeight[] = {2300, 1850, 1450, 1100, 800, 550, 350, 200};
    const int specialWeight[] = {70, 90, 120, 150, 180, 220, 260, 300};
    const auto mode = profile % 8;
    while (true) {
        const auto patterns = complementaryPatterns(special[0], special[1], capacity, sectionSize);
        struct Choice {
            ComplementaryPattern pattern;
            std::vector<int> fill;
            long long score{};
        };
        std::vector<Choice> choices;
        for (const auto& pattern : patterns) {
            if (pattern.firstCount > special[0].quantity || pattern.secondCount > special[1].quantity) continue;
            const auto fills = exactNormalFills(normal, capacity - pattern.block.physicalLength);
            for (const auto& fill : fills) {
                const auto fillerPieces = std::accumulate(fill.begin(), fill.end(), 0);
                const auto specialPieces = pattern.firstCount + pattern.secondCount;
                long long signature = 0;
                for (std::size_t index = 0; index < fill.size(); ++index) signature += (index + 3) * fill[index];
                const auto score = static_cast<long long>(pattern.block.edgeScrap) * edgeWeight[mode] +
                    static_cast<long long>(fillerPieces) * fillerWeight[mode] -
                    static_cast<long long>(specialPieces) * specialWeight[mode] +
                    ((signature * 17 + profile * 13 + pattern.block.physicalLength / sectionSize) % 31);
                choices.push_back({pattern, fill, score});
            }
        }
        if (choices.empty()) break;
        std::sort(choices.begin(), choices.end(), [](const auto& left, const auto& right) {
            if (left.score != right.score) return left.score < right.score;
            return left.pattern.block.physicalLength > right.pattern.block.physicalLength;
        });
        const auto& selected = choices.front();
        std::vector<Length> filler;
        for (std::size_t index = 0; index < selected.fill.size(); ++index) {
            for (int count = 0; count < selected.fill[index]; ++count) filler.push_back(normal[index].length);
            normal[index].quantity -= selected.fill[index];
        }
        special[0].quantity -= selected.pattern.firstCount;
        special[1].quantity -= selected.pattern.secondCount;
        construction.blocks.push_back(fillRecipeBlock(selected.pattern.block, filler, sectionSize));
    }
    construction.remainingSpecial = special;
    construction.remainingNormal = normal;
    return construction;
}

std::vector<RecipeBin> placeRecipeBlocks(
    std::vector<RecipeBlock> blocks,
    Length capacity,
    const std::vector<Length>& offcuts
) {
    std::vector<RecipeBin> bins;
    for (const auto offcut : offcuts) bins.push_back({offcut, 0, true, {}});
    std::sort(blocks.begin(), blocks.end(), [](const auto& left, const auto& right) {
        return left.physicalLength > right.physicalLength;
    });
    for (const auto& block : blocks) {
        int target = -1;
        Length smallestRemainder = std::numeric_limits<Length>::max();
        for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
            const auto remainder = bins[index].capacity - bins[index].used;
            if (remainder < block.physicalLength) continue;
            const auto remainderAfter = remainder - block.physicalLength;
            if (remainderAfter < smallestRemainder ||
                (remainderAfter == smallestRemainder && bins[index].isOffcut && (target < 0 || !bins[target].isOffcut))) {
                target = index;
                smallestRemainder = remainderAfter;
            }
        }
        if (target < 0) {
            bins.push_back({capacity, 0, false, {}});
            target = static_cast<int>(bins.size()) - 1;
        }
        bins[target].used += block.physicalLength;
        bins[target].blocks.push_back(block);
    }
    return bins;
}

PairingPlan pairingPlanForRecipe(const std::vector<RecipeBin>& bins) {
    PairingPlan plan;
    for (const auto& bin : bins) {
        for (const auto& block : bin.blocks) {
            plan.fullSections += block.fullSections;
            plan.scrapLength += block.edgeScrap;
            for (const auto& join : block.joins) {
                ++plan.pairedSections;
                plan.pairs.emplace_back(join.first, join.second, 1);
            }
            for (const auto endpoint : block.exposedEnds) {
                ++plan.singleSections;
                ++plan.singles[endpoint];
            }
        }
    }
    return plan;
}

Metrics metricsForRecipe(const std::vector<RecipeBin>& bins, Length threshold) {
    Metrics metrics;
    for (const auto& bin : bins) {
        if (!bin.used) continue;
        const auto remainder = bin.capacity - bin.used;
        if (bin.isOffcut) {
            metrics.offcutConsumed += bin.used;
            ++metrics.offcutsUsed;
        } else {
            ++metrics.newRolls;
            metrics.newRemainder += remainder;
        }
        if (remainder > 0 && remainder < threshold) {
            metrics.deadScrapLength += remainder;
            ++metrics.deadScrapCount;
        }
        if (remainder > 0 && remainder >= threshold) {
            metrics.recoverableRemainder += remainder;
            ++metrics.recoverableRemainderCount;
            metrics.largestRecoverableRemainder = std::max(metrics.largestRecoverableRemainder, remainder);
        }
        for (const auto& block : bin.blocks) {
            if (block.edgeScrap) {
                metrics.deadScrapLength += block.edgeScrap;
                ++metrics.deadScrapCount;
            }
        }
    }
    return metrics;
}

using RecipeObjective = std::tuple<Length, int, Length, int, Length, Length, int, std::vector<Length>>;

RecipeObjective recipeObjectiveFor(const std::vector<RecipeBin>& bins, Length threshold, bool concentration = true) {
    const auto metrics = metricsForRecipe(bins, threshold);
    return {
        metrics.deadScrapLength,
        metrics.deadScrapCount,
        -metrics.offcutConsumed,
        metrics.newRolls,
        metrics.newRemainder,
        -metrics.recoverableRemainder,
        concentration ? metrics.recoverableRemainderCount : 0,
        concentration ? concentratedTailScore(bins, threshold) : std::vector<Length>{},
    };
}

bool isRecipeResultBetter(const std::vector<RecipeBin>& candidate, const std::vector<RecipeBin>& current, Length threshold) {
    return recipeObjectiveFor(candidate, threshold) < recipeObjectiveFor(current, threshold);
}

// Free normal filler cuts from previously reserved full-roll recipes so they
// can be reassigned across rolls. The complementary chains themselves stay
// intact, including both end fillers and every physical join.
std::vector<RecipeBlock> releaseNormalFillers(const std::vector<RecipeBlock>& blocks, Length sectionSize) {
    std::vector<RecipeBlock> released;
    for (const auto& block : blocks) {
        if (block.sequences.size() != 1 || block.items.size() <= block.sequences[0].items.size()) {
            released.push_back(block); continue;
        }
        auto chain = block;
        const auto specialCount = block.sequences[0].items.size();
        for (std::size_t index = specialCount; index < block.items.size(); ++index) {
            const auto length = block.items[index];
            chain.productLength -= length; chain.physicalLength -= length; chain.fullSections -= length / sectionSize;
            released.push_back(normalBlock(length, sectionSize));
        }
        chain.items.resize(specialCount);
        chain.layout.resize(specialCount + 2);
        released.push_back(std::move(chain));
    }
    return released;
}

std::vector<RecipeBin> placeRecipeSubsets(const std::vector<RecipeBlock>& blocks, Length capacity,
                                        const std::vector<Length>& offcuts, int profile) {
    std::vector<Length> lengths;
    std::map<Length, std::vector<RecipeBlock>> byLength;
    for (const auto& block : blocks) { lengths.push_back(block.physicalLength); byLength[block.physicalLength].push_back(block); }
    const auto packed = buildSubsetFit(lengths, capacity, offcuts, profile);
    std::vector<RecipeBin> result;
    for (const auto& bin : packed) {
        RecipeBin recipe{bin.capacity, bin.used, bin.isOffcut, {}};
        for (const auto length : bin.items) {
            recipe.blocks.push_back(byLength[length].back()); byLength[length].pop_back();
        }
        result.push_back(std::move(recipe));
    }
    return result;
}

// BFD is excellent at closing rolls, but it can scatter 50/100 mm remainders
// across many rolls.  Move ordinary cuts out of those short tails when doing
// so turns them into recoverable inventory elsewhere.  Special chains remain
// atomic, so this post-processing cannot invalidate an end-segment join.
void improveRecipeRemainders(std::vector<RecipeBin>& bins, Length threshold, int maxSteps = 180, bool concentration = true) {
    auto currentObjective = recipeObjectiveFor(bins, threshold, concentration);
    for (int step = 0; step < maxSteps; ++step) {
        std::vector<int> sources;
        for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
            const auto remainder = bins[index].capacity - bins[index].used;
            if (bins[index].used && remainder > 0 && remainder < threshold) sources.push_back(index);
        }
        std::sort(sources.begin(), sources.end(), [&](int left, int right) {
            return bins[left].capacity - bins[left].used < bins[right].capacity - bins[right].used;
        });
        bool improved = false;
        for (const auto sourceIndex : sources) {
            std::vector<std::size_t> movable;
            for (std::size_t blockIndex = 0; blockIndex < bins[sourceIndex].blocks.size(); ++blockIndex) {
                const auto& block = bins[sourceIndex].blocks[blockIndex];
                if (block.sequences.empty() && block.items.size() == 1) movable.push_back(blockIndex);
            }
            std::sort(movable.begin(), movable.end(), [&](std::size_t left, std::size_t right) {
                return bins[sourceIndex].blocks[left].physicalLength > bins[sourceIndex].blocks[right].physicalLength;
            });
            for (const auto blockIndex : movable) {
                const auto block = bins[sourceIndex].blocks[blockIndex];
                std::vector<int> targets;
                for (int index = 0; index < static_cast<int>(bins.size()); ++index) {
                    if (index != sourceIndex && bins[index].capacity - bins[index].used >= block.physicalLength) targets.push_back(index);
                }
                std::sort(targets.begin(), targets.end(), [&](int left, int right) {
                    const auto leftAfter = bins[left].capacity - bins[left].used - block.physicalLength;
                    const auto rightAfter = bins[right].capacity - bins[right].used - block.physicalLength;
                    return leftAfter < rightAfter;
                });
                for (const auto targetIndex : targets) {
                    auto& source = bins[sourceIndex];
                    auto& target = bins[targetIndex];
                    source.blocks.erase(source.blocks.begin() + static_cast<std::ptrdiff_t>(blockIndex));
                    source.used -= block.physicalLength;
                    target.blocks.push_back(block);
                    target.used += block.physicalLength;
                    const auto candidateObjective = recipeObjectiveFor(bins, threshold, concentration);
                    if (candidateObjective < currentObjective) {
                        currentObjective = candidateObjective;
                        improved = true;
                        break;
                    }
                    target.blocks.pop_back();
                    target.used -= block.physicalLength;
                    source.blocks.insert(source.blocks.begin() + static_cast<std::ptrdiff_t>(blockIndex), block);
                    source.used += block.physicalLength;
                }
                if (improved) break;
            }
            if (improved) break;
        }
        if (!improved) break;
    }
}

void concentrateRecipeRemainders(std::vector<RecipeBin>& bins, Length sectionSize, Length threshold) {
    std::vector<Bin> physical;
    std::map<Length, std::vector<RecipeBlock>> blocks;
    for (const auto& bin : bins) {
        Bin stock{bin.capacity, bin.used, bin.isOffcut, {}};
        for (const auto& block : releaseNormalFillers(bin.blocks, sectionSize)) {
            stock.items.push_back(block.physicalLength);
            blocks[block.physicalLength].push_back(block);
        }
        physical.push_back(std::move(stock));
    }
    // Repack complete physical chains as atomic pieces. Complementary ends
    // are never separated, even when ordinary fillers move between rolls.
    concentrateRemainders(physical, threshold);
    std::vector<RecipeBin> candidate;
    for (const auto& stock : physical) {
        RecipeBin bin{stock.capacity, stock.used, stock.isOffcut, {}};
        for (const auto length : stock.items) {
            bin.blocks.push_back(std::move(blocks[length].back())); blocks[length].pop_back();
        }
        candidate.push_back(std::move(bin));
    }
    if (isRecipeResultBetter(candidate, bins, threshold)) bins = std::move(candidate);
}

bool isSymmetricComplementaryPair(const std::vector<SpecialSpec>& special, Length sectionSize) {
    return special.size() == 2 && special[0].start == special[0].end && special[1].start == special[1].end &&
           special[0].start + special[1].start == sectionSize;
}

// Independent compatibility components can be optimised without losing any
// possible join between them. An unrelated third type must not disable the
// exact alternating-chain search for a complementary pair.
std::vector<std::vector<SpecialSpec>> pitchComponents(const std::vector<SpecialSpec>& special, Length sectionSize) {
    std::vector<std::vector<SpecialSpec>> components;
    std::vector<bool> visited(special.size());
    for (std::size_t root = 0; root < special.size(); ++root) {
        if (visited[root]) continue;
        std::vector<std::size_t> queue{root};
        visited[root] = true;
        for (std::size_t position = 0; position < queue.size(); ++position) {
            const auto index = queue[position];
            for (std::size_t next = 0; next < special.size(); ++next) {
                if (visited[next]) continue;
                if (special[index].end + special[next].start != sectionSize &&
                    special[next].end + special[index].start != sectionSize) continue;
                visited[next] = true;
                queue.push_back(next);
            }
        }
        std::sort(queue.begin(), queue.end());
        std::vector<SpecialSpec> component;
        for (const auto index : queue) component.push_back(special[index]);
        components.push_back(std::move(component));
    }
    return components;
}

RecipeResult solveRecipe(
    const std::vector<std::tuple<Length, int, Length, Length>>& orders,
    Length capacity,
    Length sectionSize,
    Length threshold,
    const std::vector<Length>& offcuts
) {
    if (capacity % sectionSize != 0) throw std::runtime_error("Pitch-mode roll length must be a multiple of the pitch.");
    for (const auto offcut : offcuts) {
        if (offcut % sectionSize != 0) throw std::runtime_error("Pitch-mode offcuts must be multiples of the pitch.");
    }
    std::vector<NormalSpec> normal;
    std::vector<SpecialSpec> special;
    for (const auto& [length, quantity, start, end] : orders) {
        if (!start && !end) {
            if (length % sectionSize != 0) throw std::runtime_error("Non-pitch order needs a special start/end specification.");
            normal.push_back({length, quantity});
            continue;
        }
        if (!start || !end || start >= sectionSize || end >= sectionSize || length < start + end ||
            (length - start - end) % sectionSize != 0) {
            throw std::runtime_error("Special specification must satisfy length - start - end = a whole number of pitches.");
        }
        special.push_back({length, quantity, start, end});
    }
    std::vector<RecipeBlock> selectedBlocks;
    std::vector<RecipeBin> selectedBins;
    std::vector<RecipeBlock> legacyBlocks;
    std::vector<RecipeBin> legacyBins;
    bool hasCandidate = false;
    const auto consider = [&](const std::vector<RecipeBlock>& specialBlocks, bool searchSubsets = false) {
        auto blocks = specialBlocks;
        auto bins = placeRecipeBlocks(blocks, capacity, offcuts);
        improveRecipeRemainders(bins, threshold, 180, false);
        auto primaryBest = bins;
        if (searchSubsets) {
            for (int profile = 0; profile < 8; ++profile) {
                auto candidate = placeRecipeSubsets(blocks, capacity, offcuts, profile);
                if (candidate.empty()) continue;
                improveRecipeRemainders(candidate, threshold, 180, false);
                if (recipeObjectiveFor(candidate, threshold, false) < recipeObjectiveFor(primaryBest, threshold, false)) primaryBest = candidate;
                if (isRecipeResultBetter(candidate, bins, threshold)) bins = std::move(candidate);
            }
        }
        if (!hasCandidate || recipeObjectiveFor(primaryBest, threshold, false) < recipeObjectiveFor(legacyBins, threshold, false)) {
            legacyBlocks = blocks; legacyBins = std::move(primaryBest);
        }
        if (!hasCandidate || isRecipeResultBetter(bins, selectedBins, threshold)) {
            selectedBlocks = blocks;
            selectedBins = bins;
            hasCandidate = true;
        }
    };

    if (special.empty()) {
        consider(normalBlocksFor(normal, sectionSize));
    } else if (isSymmetricComplementaryPair(special, sectionSize)) {
        Length smallestSpecialFootprint = 0;
        for (const auto& item : special) {
            smallestSpecialFootprint = std::max(smallestSpecialFootprint, item.length + (sectionSize - item.start) + (sectionSize - item.end));
        }
        // Try several valid chain lengths.  A long chain has fewer exposed ends,
        // while a shorter one can leave exactly 700 / 950 / 150-sized spaces for
        // ordinary orders. Candidates retain the pitch-mode objective:
        // non-recoverable physical scrap first, then stock use and roll count.
        for (Length maximumBlockLength = smallestSpecialFootprint; maximumBlockLength <= capacity; maximumBlockLength += sectionSize) {
            std::vector<RecipeBlock> specialBlocks;
            if (makeExactComplementaryBlocks(special, maximumBlockLength, sectionSize, specialBlocks)) {
                auto blocks = normalBlocksFor(normal, sectionSize);
                blocks.insert(blocks.end(), specialBlocks.begin(), specialBlocks.end());
                consider(blocks);
            }
        }
        // BFD alone cannot see that a shorter special chain can deliberately
        // reserve 950+700 or 1,000+800.  Test several exact-roll recipe
        // profiles before handing only the genuine leftovers to BFD.
        for (int profile = 0; profile < 24; ++profile) {
            const auto construction = makeFilledRecipeConstruction(special, normal, capacity, sectionSize, profile);
            auto blocks = construction.blocks;
            const auto outstandingSpecial = construction.remainingSpecial[0].quantity + construction.remainingSpecial[1].quantity;
            if (outstandingSpecial) {
                std::vector<RecipeBlock> leftoverSpecial;
                if (!makeExactComplementaryBlocks(construction.remainingSpecial, capacity, sectionSize, leftoverSpecial)) continue;
                blocks.insert(blocks.end(), leftoverSpecial.begin(), leftoverSpecial.end());
            }
            auto leftoverNormal = normalBlocksFor(construction.remainingNormal, sectionSize);
            blocks.insert(blocks.end(), leftoverNormal.begin(), leftoverNormal.end());
            consider(blocks);
        }
    } else {
        auto blocks = normalBlocksFor(normal, sectionSize);
        const auto specialBlocks = makeGreedyPitchBlocks(special, capacity, sectionSize);
        blocks.insert(blocks.end(), specialBlocks.begin(), specialBlocks.end());
        consider(blocks);
    }
    const auto components = pitchComponents(special, sectionSize);
    const auto hasExactPair = std::any_of(components.begin(), components.end(), [&](const auto& component) {
        return isSymmetricComplementaryPair(component, sectionSize);
    });
    if (components.size() > 1 && hasExactPair) {
        const auto started = std::chrono::steady_clock::now();
        using BlockLayout = std::vector<std::pair<Length, bool>>;
        std::set<std::vector<BlockLayout>> seenLayouts;
        const auto considerUnique = [&](const auto& blocks) {
            std::vector<BlockLayout> signature;
            for (const auto& block : blocks) {
                BlockLayout layout;
                for (const auto& segment : block.layout) layout.emplace_back(segment.length, segment.isEdgeScrap);
                signature.push_back(std::move(layout));
            }
            std::sort(signature.begin(), signature.end());
            // Adjacent pitch limits often produce precisely the same chains.
            // Spend the bounded packing search on different physical layouts.
            if (seenLayouts.insert(std::move(signature)).second) consider(blocks, true);
        };
        const auto appendChains = [&](const auto& component, Length maximum, auto& blocks) {
            std::vector<RecipeBlock> chains;
            if (!isSymmetricComplementaryPair(component, sectionSize) ||
                !makeExactComplementaryBlocks(component, maximum, sectionSize, chains))
                chains = makeGreedyPitchBlocks(component, capacity, sectionSize);
            blocks.insert(blocks.end(), chains.begin(), chains.end());
        };
        // Long chains first: find the minimum exposed-end scrap before trying
        // smaller chains which may admit better ordinary-cut fillers.
        Length minimum = 0;
        for (const auto& item : special) minimum = std::max(minimum, item.length + 2 * sectionSize - item.start - item.end);
        for (Length maximum = capacity; maximum >= minimum; maximum -= sectionSize) {
            auto blocks = normalBlocksFor(normal, sectionSize);
            for (const auto& component : components) appendChains(component, maximum, blocks);
            considerUnique(blocks);
            if (std::chrono::steady_clock::now() - started > std::chrono::seconds(3)) break;
        }
        // Reserve exact full-roll fillers for each compatible pair while all
        // components share the same remaining ordinary-order quantities.
        for (int profile = 0; profile < 24; ++profile) {
            auto remainingNormal = normal;
            std::vector<RecipeBlock> blocks;
            for (std::size_t position = 0; position < components.size(); ++position) {
                const auto index = profile % 2 ? components.size() - position - 1 : position;
                const auto& component = components[index];
                if (isSymmetricComplementaryPair(component, sectionSize)) {
                    const auto construction = makeFilledRecipeConstruction(component, remainingNormal, capacity, sectionSize, profile);
                    blocks.insert(blocks.end(), construction.blocks.begin(), construction.blocks.end());
                    remainingNormal = construction.remainingNormal;
                    appendChains(construction.remainingSpecial, capacity, blocks);
                } else appendChains(component, capacity, blocks);
            }
            const auto leftover = normalBlocksFor(remainingNormal, sectionSize);
            blocks.insert(blocks.end(), leftover.begin(), leftover.end());
            considerUnique(blocks);
            if (std::chrono::steady_clock::now() - started > std::chrono::seconds(5)) break;
        }
    }
    if (!hasCandidate) throw std::runtime_error("Unable to construct a physical pitch layout for the supplied special specifications.");
    const auto released = releaseNormalFillers(selectedBlocks, sectionSize);
    for (int profile = 0; profile < 16; ++profile) {
        auto candidate = placeRecipeSubsets(released, capacity, offcuts, profile);
        if (candidate.empty()) continue;
        improveRecipeRemainders(candidate, threshold);
        if (isRecipeResultBetter(candidate, selectedBins, threshold)) selectedBins = std::move(candidate);
    }
    // Preserve the old scoring trajectory as well. A locally attractive tail
    // tie-break must not hide a better concentration found by its final repack.
    const auto legacyReleased = releaseNormalFillers(legacyBlocks, sectionSize);
    for (int profile = 0; profile < 16; ++profile) {
        auto candidate = placeRecipeSubsets(legacyReleased, capacity, offcuts, profile);
        if (candidate.empty()) continue;
        improveRecipeRemainders(candidate, threshold, 180, false);
        if (recipeObjectiveFor(candidate, threshold, false) < recipeObjectiveFor(legacyBins, threshold, false)) legacyBins = std::move(candidate);
    }
    if (isRecipeResultBetter(legacyBins, selectedBins, threshold)) selectedBins = std::move(legacyBins);
    concentrateRecipeRemainders(selectedBins, sectionSize, threshold);
    const auto baseline = offcuts.empty() ? selectedBins : solveRecipe(orders, capacity, sectionSize, threshold, {}).bins;
    return {selectedBins, baseline, pairingPlanForRecipe(selectedBins)};
}

void writeNumberArray(const std::vector<Length>& values) {
    std::cout << '[';
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index) std::cout << ',';
        std::cout << values[index];
    }
    std::cout << ']';
}

void writeBin(const Bin& bin) {
    std::cout << "{\"capacity\":" << bin.capacity
              << ",\"used\":" << bin.used
              << ",\"remainder\":" << remaining(bin)
              << ",\"items\":";
    writeNumberArray(bin.items);
    std::cout << '}';
}

void writeRecipeBin(const RecipeBin& bin, Length sectionSize) {
    std::vector<Length> items;
    std::map<std::pair<Length, Length>, Length> pairs;
    std::map<Length, Length> singles;
    Length fullSections = 0;
    Length pairedSections = 0;
    Length edgeScrap = 0;
    for (const auto& block : bin.blocks) {
        items.insert(items.end(), block.items.begin(), block.items.end());
        fullSections += block.fullSections;
        edgeScrap += block.edgeScrap;
        for (const auto& pair : block.joins) {
            ++pairedSections;
            ++pairs[pair];
        }
        for (const auto endpoint : block.exposedEnds) ++singles[endpoint];
    }
    const auto regularSections = bin.used / sectionSize - pairedSections;
    const auto productLength = std::accumulate(items.begin(), items.end(), Length{0});
    std::cout << "{\"capacity\":" << bin.capacity
              << ",\"used\":" << bin.used
              << ",\"remainder\":" << (bin.capacity - bin.used)
              << ",\"productLength\":" << productLength
              << ",\"edgeScrap\":" << edgeScrap
              << ",\"pairedSections\":" << pairedSections
              << ",\"regularSections\":" << regularSections
              << ",\"fullSections\":" << fullSections
              << ",\"pairDetails\":[";
    bool first = true;
    for (const auto& [pair, count] : pairs) {
        if (!first) std::cout << ',';
        std::cout << "{\"left\":" << pair.first << ",\"right\":" << pair.second << ",\"count\":" << count << '}';
        first = false;
    }
    std::cout << "],\"singleDetails\":[";
    first = true;
    for (const auto& [value, count] : singles) {
        if (!first) std::cout << ',';
        std::cout << "{\"value\":" << value << ",\"count\":" << count << '}';
        first = false;
    }
    std::cout << "],\"items\":";
    writeNumberArray(items);
    std::cout << ",\"sequenceDetails\":[";
    first = true;
    for (const auto& block : bin.blocks) {
        for (const auto& sequence : block.sequences) {
            if (!first) std::cout << ',';
            std::cout << "{\"items\":";
            writeNumberArray(sequence.items);
            std::cout << ",\"leftScrap\":" << sequence.leftScrap
                      << ",\"rightScrap\":" << sequence.rightScrap
                      << ",\"edgeScrap\":" << (sequence.leftScrap + sequence.rightScrap) << '}';
            first = false;
        }
    }
    std::cout << "],\"layoutSegments\":[";
    first = true;
    const auto writeSegment = [&](Length length, const char* kind) {
        if (!first) std::cout << ',';
        std::cout << "{\"length\":" << length << ",\"kind\":\"" << kind << "\"}";
        first = false;
    };
    for (const auto& block : bin.blocks) {
        for (const auto& segment : block.layout) writeSegment(segment.length, segment.isEdgeScrap ? "edgeScrap" : "product");
    }
    std::cout << "]}";
}

void writeSectionBin(const SectionBin& bin, Length sectionSize) {
    const auto used = usedSections(bin);
    std::cout << "{\"capacity\":" << bin.capacitySections * sectionSize
              << ",\"used\":" << used * sectionSize
              << ",\"remainder\":" << (bin.capacitySections - used) * sectionSize
              << ",\"pairedSections\":" << bin.pairedSections
              << ",\"regularSections\":" << bin.regularSections
              << ",\"fullSections\":" << bin.fullSections
              << ",\"pairDetails\":[";
    bool first = true;
    for (const auto& [pair, count] : bin.pairDetails) {
        if (!first) std::cout << ',';
        const auto& [left, right] = pair;
        std::cout << "{\"left\":" << left << ",\"right\":" << right << ",\"count\":" << count << '}';
        first = false;
    }
    std::cout << "],\"singleDetails\":[";
    first = true;
    for (const auto& [value, count] : bin.singleDetails) {
        if (!first) std::cout << ',';
        std::cout << "{\"value\":" << value << ",\"count\":" << count << '}';
        first = false;
    }
    std::cout << "],\"items\":[]}";
}

void writeSectionPlan(const PairingPlan& plan, Length sectionSize) {
    std::cout << "{\"segmentSize\":" << sectionSize
              << ",\"fullSections\":" << plan.fullSections
              << ",\"pairedSections\":" << plan.pairedSections
              << ",\"singleSections\":" << plan.singleSections
              << ",\"pairingSavings\":" << plan.pairedSections * sectionSize
              << ",\"pairs\":[";
    std::map<std::pair<Length, Length>, Length> displayedPairs;
    for (const auto& [left, right, count] : plan.pairs) {
        displayedPairs[{std::min(left, right), std::max(left, right)}] += count;
    }
    std::size_t index = 0;
    for (const auto& [pair, count] : displayedPairs) {
        if (index++) std::cout << ',';
        const auto& [left, right] = pair;
        std::cout << "{\"left\":" << left << ",\"right\":" << right << ",\"count\":" << count << '}';
    }
    std::cout << "],\"unpaired\":[";
    bool first = true;
    for (const auto& [value, count] : plan.singles) {
        if (!first) std::cout << ',';
        std::cout << "{\"value\":" << value << ",\"count\":" << count
                  << ",\"waste\":" << (sectionSize - value) * count << '}';
        first = false;
    }
    std::cout << "]}";
}

void writeMetricFields(const Metrics& metrics) {
    std::cout << "\"newRolls\":" << metrics.newRolls
              << ",\"newRemainder\":" << metrics.newRemainder
              << ",\"deadScrapLength\":" << metrics.deadScrapLength
              << ",\"deadScrapCount\":" << metrics.deadScrapCount
              << ",\"recoverableRemainder\":" << metrics.recoverableRemainder
              << ",\"offcutConsumed\":" << metrics.offcutConsumed
              << ",\"offcutsUsed\":" << metrics.offcutsUsed;
    std::cout << ",\"recoverableRemainderCount\":" << metrics.recoverableRemainderCount
              << ",\"largestRecoverableRemainder\":" << metrics.largestRecoverableRemainder;
}

void writeMetrics(const Metrics& metrics) {
    std::cout << '{';
    writeMetricFields(metrics);
    std::cout << '}';
}

int main() {
    try {
        Length capacity, threshold, sectionSize;
        int orderKinds, offcutCount;
        if (!(std::cin >> capacity >> threshold >> sectionSize >> orderKinds) ||
            capacity <= 0 || threshold < 0 || sectionSize <= 0 || orderKinds <= 0) {
            throw std::runtime_error("Invalid optimisation request.");
        }
        std::vector<Length> items;
        std::vector<std::tuple<Length, int, Length, Length>> orders;
        bool hasSectionSpecifications = false;
        Length orderLength = 0;
        Length itemCount = 0;
        for (int index = 0; index < orderKinds; ++index) {
            Length length, start, end;
            int quantity;
            if (!(std::cin >> length >> quantity >> start >> end) || length <= 0 || quantity <= 0 || start < 0 || end < 0) {
                throw std::runtime_error("Invalid order item.");
            }
            items.insert(items.end(), quantity, length);
            orders.emplace_back(length, quantity, start, end);
            hasSectionSpecifications = hasSectionSpecifications || start || end;
            orderLength += length * quantity;
            itemCount += quantity;
        }
        if (!(std::cin >> offcutCount) || offcutCount < 0) throw std::runtime_error("Invalid offcut count.");
        std::vector<Length> offcuts;
        for (int index = 0; index < offcutCount; ++index) {
            Length length;
            if (!(std::cin >> length) || length <= 0) throw std::runtime_error("Invalid offcut length.");
            offcuts.push_back(length);
        }
        const auto maxStock = std::max(capacity, offcuts.empty() ? Length{0} : *std::max_element(offcuts.begin(), offcuts.end()));
        for (const auto item : items) {
            if (item > maxStock) throw std::runtime_error("An order length exceeds every available stock length.");
        }

        if (hasSectionSpecifications) {
            const auto result = solveRecipe(orders, capacity, sectionSize, threshold, offcuts);
            const auto metrics = metricsForRecipe(result.bins, threshold);
            const auto baselineMetrics = metricsForRecipe(result.baseline, threshold);
            std::cout << "{\"summary\":{";
            writeMetricFields(metrics);
            std::cout << ",\"orderLength\":" << orderLength
                      << ",\"itemCount\":" << itemCount
                      << ",\"moves\":0,\"swaps\":0,\"sectionMode\":true,\"baseline\":";
            writeMetrics(baselineMetrics);
            std::cout << "},\"sectionPlan\":";
            writeSectionPlan(result.plan, sectionSize);
            std::cout << ",\"newBins\":[";
            bool first = true;
            for (const auto& bin : result.bins) {
                if (bin.isOffcut || !bin.used) continue;
                if (!first) std::cout << ',';
                writeRecipeBin(bin, sectionSize);
                first = false;
            }
            std::cout << "],\"offcuts\":[";
            first = true;
            for (const auto& bin : result.bins) {
                if (!bin.isOffcut) continue;
                if (!first) std::cout << ',';
                writeRecipeBin(bin, sectionSize);
                first = false;
            }
            std::cout << "],\"productBins\":[";
            first = true;
            for (const auto& bin : result.bins) {
                if (bin.isOffcut || !bin.used) continue;
                if (!first) std::cout << ',';
                writeRecipeBin(bin, sectionSize);
                first = false;
            }
            std::cout << "],\"productOffcuts\":[";
            first = true;
            for (const auto& bin : result.bins) {
                if (!bin.isOffcut) continue;
                if (!first) std::cout << ',';
                writeRecipeBin(bin, sectionSize);
                first = false;
            }
            std::cout << "]}";
            return 0;
        }

        const auto result = solve(items, capacity, threshold, offcuts);
        const auto metrics = metricsFor(result.bins, threshold);
        const auto baselineMetrics = metricsFor(result.baseline, threshold);
        std::cout << "{\"summary\":{";
        writeMetricFields(metrics);
        std::cout << ",\"orderLength\":" << orderLength
                  << ",\"itemCount\":" << itemCount
                  << ",\"moves\":" << result.moves
                  << ",\"swaps\":" << result.swaps
                  << ",\"baseline\":";
        writeMetrics(baselineMetrics);
        std::cout << "},\"newBins\":[";
        bool first = true;
        for (const auto& bin : result.bins) {
            if (bin.isOffcut || bin.items.empty()) continue;
            if (!first) std::cout << ',';
            writeBin(bin);
            first = false;
        }
        std::cout << "],\"offcuts\":[";
        first = true;
        for (const auto& bin : result.bins) {
            if (!bin.isOffcut) continue;
            if (!first) std::cout << ',';
            writeBin(bin);
            first = false;
        }
        std::cout << "]}";
    } catch (const std::exception& error) {
        std::cerr << error.what();
        return 1;
    }
    return 0;
}
