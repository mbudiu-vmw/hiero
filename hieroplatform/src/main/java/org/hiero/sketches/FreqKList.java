package org.hiero.sketches;

import org.hiero.dataset.api.IJson;
import org.hiero.dataset.api.Pair;
import org.hiero.table.RowSnapshot;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * A data structure to store the K heavy hitters our of N elements, computed by the Misra-Gries
 * algorithm. We use the mergeable version of MG, as described in the ACM TODS paper "Mergeable
 * Summaries" by Agarwal et al., which gives a good error bound.
 * It stores a hash-map which contains the elements and their counts, along with counts
 * of the size of the input and the number of counters (K).
 */
public class FreqKList implements Serializable, IJson {
    /**
     * The size of the input table.
     */
    public final long totalRows;
    /**
     * The number of counters we store: the K in top-K heavy hitters.
     */
    public final int maxSize;
    /**
     * Estimate for the number of times each row in the above table occurs in the original DataSet.
     */
    public final HashMap<RowSnapshot, Integer> hMap;

    public FreqKList(long totalRows, int maxSize, HashMap<RowSnapshot, Integer> hMap) {
        this.totalRows = totalRows;
        this.maxSize = maxSize;
        this.hMap = hMap;
    }

    /**
     * This method returns the sum of counts computed by the data structure. This is always less
     * than totalRows, the number of rows in the table.
     * @return The sum of all counts stored in the hash-map.
     */
    public int GetTotalCount() {
        return this.hMap.values().stream().reduce(0, Integer::sum);
    }

    /**
     * The error bound guaranteed by the "Mergeable Summaries" paper. It holds if a particular
     * sketch algorithm is applied to the Misra-Gries map. In particular, if the sum of observed
     * frequencies equals the total length of the table, the error is zero. Two notable properties
     * of this error bound:
     * - The frequency f(i) in the table is always an underestimate
     * - The true frequency lies between f(i) and f(i) + e, where e is the bound returned below.
     * @return Integer e such that if an element i has a count f(i) in the data
     * structure, then its true frequency in the range [f(i), f(i) +e].
     */
    public int GetErrBound() {
        return (int) (this.totalRows - this.GetTotalCount())/(this.maxSize + 1);
    }

    @SuppressWarnings("ConstantConditions")
    @Override
    public String toString() {
        List<Pair<RowSnapshot, Integer>> pList = new
                ArrayList<Pair<RowSnapshot, Integer>>(this.hMap.size());
        this.hMap.forEach((rs, j) -> pList.add(new Pair<RowSnapshot, Integer>(rs, j)));
        pList.sort((p1, p2) -> Integer.compare(p2.second, p1.second));
        final StringBuilder builder = new StringBuilder();
        pList.forEach(p ->  builder.append(p.first.toString()).append(": (").append(p.second)
                                   .append("-").append(p.second + GetErrBound())
                                   .append(")").append(System.getProperty("line.separator")));
        builder.append("Error bound: ").append(this.GetErrBound())
               .append(System.getProperty("line.separator"));
        return builder.toString();
    }
}