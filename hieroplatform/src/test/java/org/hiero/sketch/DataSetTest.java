/*
 * Copyright (c) 2017 VMware Inc. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

package org.hiero.sketch;

import org.hiero.sketch.dataset.LocalDataSet;
import org.hiero.sketch.dataset.ParallelDataSet;
import org.hiero.sketch.dataset.api.*;
import org.hiero.utils.Converters;
import org.junit.Test;
import rx.Observable;
import rx.observers.TestSubscriber;

import javax.annotation.Nullable;
import java.util.ArrayList;

import static org.junit.Assert.*;

public class DataSetTest {
    private class Increment implements IMap<Integer, Integer> {
        @Override
        public Integer apply(final @Nullable Integer data) {
            return Converters.checkNull(data) + 1;
        }
    }

    private class Sketch implements ISketch<Integer, Integer> {
        @Override
        public Integer zero() {
            return 0;
        }

        @Override
        public Integer add(@Nullable final Integer left, @Nullable final Integer right) {
            return Converters.checkNull(left) + Converters.checkNull(right);
        }

        @Override
        public Integer create(@Nullable final Integer data) {
            return Converters.checkNull(data);
        }
    }

    @Test
    public void localDataSetTest() {
        final LocalDataSet<Integer> ld = new LocalDataSet<Integer>(4);
        final Increment increment = new Increment();

        final IDataSet<Integer> r = ld.blockingMap(increment);
        final Sketch sketch = new Sketch();
        final int result = r.blockingSketch(sketch);
        assertEquals(result, 5);
    }

    @Test
    public void parallelDataSetTest() {
        final LocalDataSet<Integer> ld1 = new LocalDataSet<Integer>(4);
        final LocalDataSet<Integer> ld2 = new LocalDataSet<Integer>(5);
        final ArrayList<IDataSet<Integer>> elems = new ArrayList<IDataSet<Integer>>(2);
        elems.add(ld1);
        elems.add(ld2);
        final ParallelDataSet<Integer> par = new ParallelDataSet<>(elems);
        final Increment increment = new Increment();

        final IDataSet<Integer> r1 = par.blockingMap(increment);
        final Sketch sketch = new Sketch();
        final int result = r1.blockingSketch(sketch);
        assertEquals(result, 11);

        final IDataSet<Integer> r2 = r1.blockingMap(increment);
        final int result1 = r2.blockingSketch(sketch);
        assertEquals(result1, 13);
    }

    private class Sum implements ISketch<int[], Integer> {
        @Override
        public Integer zero() {
            return 0;
        }

        @Override
        public Integer add(@Nullable final Integer left, @Nullable final Integer right) {
            return Converters.checkNull(left) + Converters.checkNull(right);
        }

        @Override
        public Integer create(@Nullable final int[] data) {
            int sum = 0;
            for (int aData : Converters.checkNull(data)) sum += aData;
            return sum;
        }
    }

    private final int largeSize = 10 * 1024 * 1024;
    private static final int parts = 10;

    private ParallelDataSet<int[]> createLargeDataset(final boolean separateThread) {
        ArrayList<IDataSet<int[]>> l = new ArrayList<IDataSet<int[]>>(parts);
        int v = 0;
        for (int j=0; j < parts; j++) {
            int partSize = this.largeSize / parts;
            final int[] data = new int[partSize];
            for (int i = 0; i < partSize; i++) {
                data[i] = ((v % 10) == 0) ? 0 : v;
                v++;
            }
            LocalDataSet<int[]> ld = new LocalDataSet<int[]>(data, separateThread);
            l.add(ld);
        }
        return new ParallelDataSet<int[]>(l);
    }

    @Test
    public void largeDataSetTest() {
        ParallelDataSet<int[]> ld = this.createLargeDataset(false);
        int result = ld.blockingSketch(new Sum());
        int sum = 0;
        for (int i=0; i < this.largeSize; i++)
            sum += ((i % 10) == 0) ? 0 : i;
        assertEquals(result, sum);

        ld.setBundleInterval(100);
        result = ld.blockingSketch(new Sum());
        assertEquals(result, sum);

        ld = this.createLargeDataset(true);
        ld.setBundleInterval(100);
        result = ld.blockingSketch(new Sum());
        assertEquals(result, sum);
    }

    @Test
    public void separateThreadDataSetTest() {
        final IDataSet<int[]> ld = this.createLargeDataset(true);
        final int result = ld.blockingSketch(new Sum());
        int sum = 0;
        for (int i=0; i < this.largeSize; i++)
            sum += ((i % 10) == 0) ? 0 : i;
        assertEquals(result, sum);
    }

    @Test
    public void unsubscriptionTest() {
        ParallelDataSet<int[]> ld = this.createLargeDataset(true);
        ld.setBundleInterval(0);  // important for this test
        Observable<PartialResult<Integer>> pr = ld.sketch(new Sum());
        TestSubscriber<PartialResult<Integer>> ts =
                new TestSubscriber<PartialResult<Integer>>() {
            private int count = 0;

            @Override
            public void onNext(final PartialResult<Integer> pr) {
                super.onNext(pr);
                this.count++;
                if (this.count == 3)
                    this.unsubscribe();
            }
        };
        pr.toBlocking().subscribe(ts);

        ts.assertNotCompleted();
        ts.assertValueCount(3);
    }
}