/*
 * Copyright (c) 2020 VMware Inc. All Rights Reserved.
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
 */

package org.hillview.sketches;

import org.hillview.sketches.highorder.GroupBySketch;
import org.hillview.sketches.highorder.GroupByWorkspace;
import org.hillview.sketches.results.Count;
import org.hillview.sketches.results.Groups;
import org.hillview.sketches.results.IHistogramBuckets;
import org.hillview.table.api.ITable;

/**
 * 3D histogram computed using 3 nested GroupBy sketches.
 */
public class Histogram3DSketch extends GroupBySketch<
        Groups<Groups<Count>>,
        GroupByWorkspace<GroupByWorkspace<EmptyWorkspace>>,
        Histogram2DSketch> {

    private final IHistogramBuckets superSuperBuckets;

    public Histogram3DSketch(
            IHistogramBuckets buckets0,
            IHistogramBuckets buckets1,
            IHistogramBuckets buckets2) {
        super(buckets2, new Histogram2DSketch(buckets0, buckets1));
        this.superSuperBuckets = buckets0;
    }

    @Override
    public GroupByWorkspace<GroupByWorkspace<GroupByWorkspace<EmptyWorkspace>>> initialize(ITable data) {
        data.getLoadedColumns(buckets.getColumn(), super.buckets.getColumn(), this.superSuperBuckets.getColumn());
        return super.initialize(data);
    }
}
