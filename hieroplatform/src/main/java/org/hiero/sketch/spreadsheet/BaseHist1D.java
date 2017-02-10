package org.hiero.sketch.spreadsheet;

import org.checkerframework.checker.nullness.qual.NonNull;
import org.hiero.sketch.table.api.IColumn;
import org.hiero.sketch.table.api.IMembershipSet;
import org.hiero.sketch.table.api.IStringConverter;

public abstract class BaseHist1D implements IHistogram1D {

    final protected IBucketsDescription1D bucketDescription;

    public BaseHist1D(final @NonNull IBucketsDescription1D bucketDescription) {
        this.bucketDescription = bucketDescription;
    }

    @Override
    public int getNumOfBuckets() { return this.bucketDescription.getNumOfBuckets(); }

    @Override
    public void createSampleHistogram(final IColumn column, final IMembershipSet membershipSet,
                                      final IStringConverter converter, double sampleRate) {
        this.createHistogram(column, membershipSet.sample(sampleRate), converter);
    }

    @Override
    public void createSampleHistogram(final IColumn column, final IMembershipSet membershipSet,
                                      final IStringConverter converter, double sampleRate, long seed) {
        this.createHistogram(column, membershipSet.sample(sampleRate, seed), converter);
    }
}
