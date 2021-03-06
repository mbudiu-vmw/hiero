/*
 * Copyright (c) 2017 VMware Inc. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {event as d3event, mouse as d3mouse} from "d3-selection";
import {Histogram2DSerialization, IViewSerialization} from "../datasetView";
import {
    IColumnDescription,
    kindIsString,
    RemoteObjectId, kindIsNumeric, Groups, RangeFilterArrayDescription,
} from "../javaBridge";
import {Receiver, RpcRequest} from "../rpc";
import {BaseReceiver, TableTargetAPI} from "../modules";
import {CDFPlot} from "../ui/cdfPlot";
import {IDataView} from "../ui/dataview";
import {FullPage, PageTitle} from "../ui/fullPage";
import {Histogram2DPlot} from "../ui/histogram2DPlot";
import {HistogramLegendPlot} from "../ui/histogramLegendPlot";
import {SubMenu, TopMenu} from "../ui/menu";
import {HtmlPlottingSurface} from "../ui/plottingSurface";
import {TextOverlay} from "../ui/textOverlay";
import {ChartOptions, DragEventKind, HtmlString, Resolution} from "../ui/ui";
import {
    add, assert, assertNever,
    Converters, Exporter, Heatmap,
    ICancellable, optionToBoolean,
    Pair,
    PartialResult,
    percentString,
    reorder,
    significantDigits,
} from "../util";
import {AxisData} from "./axisData";
import {HistogramViewBase} from "./histogramViewBase";
import {NewTargetReceiver, DataRangesReceiver} from "./dataRangesReceiver";
import {Histogram2DBarsPlot} from "../ui/histogram2DBarsPlot";
import {Histogram2DBase} from "../ui/histogram2DBase";
import {Dialog, FieldKind, saveAs} from "../ui/dialog";
import {TableMeta} from "../ui/receiver";

/**
 * This class is responsible for rendering a 2D histogram.
 * This is a histogram where each bar is divided further into sub-bars.
 */
export class Histogram2DView extends HistogramViewBase<Pair<Groups<Groups<number>>, Groups<number>>> {
    protected yAxisData: AxisData;
    protected xPoints: number;
    protected yPoints: number;
    protected relative: boolean;  // true when bars are normalized to 100%
    protected stacked: boolean;
    protected plot: Histogram2DBase;
    protected legendPlot: HistogramLegendPlot;
    protected legendSurface: HtmlPlottingSurface;
    protected viewMenu: SubMenu;
    protected readonly defaultProvenance = "From 2D histogram";

    constructor(remoteObjectId: RemoteObjectId, meta: TableMeta, protected samplingRate: number, page: FullPage) {
        super(remoteObjectId, meta, page, "2DHistogram");

        this.viewMenu = new SubMenu([{
            text: "refresh",
            action: () => { this.refresh(); },
            help: "Redraw this view",
        }, {
            text: "table",
            action: () => this.showTable([this.xAxisData.description, this.yAxisData.description], this.defaultProvenance),
            help: "Show the data underlying this plot in a tabular view. ",
        }, {
            text: "exact",
            action: () => { this.exactHistogram(); },
            help: "Draw this histogram without approximations.",
        }, {
            text: "# buckets...",
            action: () => this.chooseBuckets(),
            help: "Change the number of buckets used for drawing the histogram.",
        }, {
            text: "swap axes",
            action: () => { this.swapAxes(); },
            help: "Redraw this histogram by swapping the X and Y axes.",
        }, {
            text: "quartiles",
            action: () => { this.showQuartiles(); },
            help: "Plot this data as a vector of quartiles view.",
        }, {
            text: "stacked/parallel",
            action: () => { this.toggleStacked(); },
            help: "Plot this data either as stacked bars or as parallel bars.",
        }, {
            text: "heatmap",
            action: () => { this.doHeatmap(); },
            help: "Plot this data as a heatmap view.",
        }, {
            text: "group by...",
            action: () => {
                this.trellis();
            },
            help: "Group data by a third column.",
        }, {
            text: "relative/absolute",
            action: () => this.toggleNormalize(),
            help: "In an absolute plot the Y axis represents the size for a bucket. " +
                "In a relative plot all bars are normalized to 100% on the Y axis.",
        }]);
        this.menu = new TopMenu( [
            this.exportMenu(), {
            text: "View",
            help: "Change the way the data is displayed.",
            subMenu: this.viewMenu
        },
            page.dataset!.combineMenu(this, page.pageId),
        ]);

        this.relative = false;
        this.stacked = true;
        this.page.setMenu(this.menu);
        if (this.samplingRate >= 1) {
            const submenu = this.menu.getSubmenu("View");
            submenu!.enable("exact", false);
        }
    }

    public cdf(): Groups<number> {
        return this.data.second;
    }

    public histograms(): Groups<Groups<number>> {
        return this.data.first;
    }

    private showQuartiles(): void {
       const qhr = new DataRangesReceiver(this, this.page, null,
            this.meta, [this.xPoints],
            [this.xAxisData.description, this.yAxisData.description],
            null, this.defaultProvenance, {
               reusePage: false, chartKind: "QuartileVector"
           });
        qhr.run([this.xAxisData.dataRange]);
        qhr.onCompleted();
    }

    protected createNewSurfaces(keepColorMap: boolean): void {
        if (this.legendSurface != null)
            this.legendSurface.destroy();
        if (this.surface != null)
            this.surface.destroy();
        assert(this.chartDiv != null);
        this.legendSurface = new HtmlPlottingSurface(this.chartDiv, this.page,
            { height: Resolution.legendSpaceHeight });
        if (keepColorMap) {
            this.legendPlot.setSurface(this.legendSurface);
        } else {
            this.legendPlot = new HistogramLegendPlot(this.legendSurface,
                (xl, xr) => this.selectionCompleted(xl, xr, true));
        }
        this.surface = new HtmlPlottingSurface(this.chartDiv, this.page, {});
        if (this.stacked) {
            this.plot = new Histogram2DPlot(this.surface);
            this.cdfPlot = new CDFPlot(this.surface);
        } else {
            this.plot = new Histogram2DBarsPlot(this.surface);
        }
    }

    public getAxisData(event: DragEventKind): AxisData | null {
        switch (event) {
            case "Title":
            case "GAxis":
                return null;
            case "XAxis":
                return this.xAxisData;
            case "YAxis":
                if (this.relative)
                    return null;
                const missing = this.histograms().perMissing.perBucket.reduce(add);
                const range = {
                    min: 0,
                    max: this.plot.maxYAxis != null ? this.plot.maxYAxis : this.plot.max,
                    presentCount: this.meta.rowCount - missing,
                    missingCount: missing
                };
                return new AxisData({ kind: "None", name: "" }, range, this.yAxisData.bucketCount);
            default:
                assertNever(event);
        }
        return null;
    }

    public updateView(data: Pair<Groups<Groups<number>>, Groups<number>>, maxYAxis: number | null, keepColorMap: boolean): void {
        this.viewMenu.enable("relative/absolute", this.stacked);
        this.createNewSurfaces(keepColorMap);
        if (data == null) {
            this.page.reportError("No data to display");
            return;
        }
        this.data = data;
        this.xPoints = this.histograms().perBucket.length;
        this.yPoints = this.histograms().perBucket[0].perBucket.length;
        if (this.yPoints === 0) {
            this.page.reportError("No data to display");
            return;
        }

        const bucketCount = this.xPoints;
        const canvas = this.surface!.getCanvas();

        // Must setup legend before drawing the data to have the colormap
        const missingShown = this.histograms().perBucket.map(b => b.perMissing).reduce(add);
        if (!keepColorMap)
            this.legendPlot.setData(this.yAxisData, missingShown > 0);
        this.legendPlot.draw();

        const heatmap: Pair<Groups<Groups<number>>, Groups<Groups<number>> | null> =
            {first: this.histograms(), second: null};
        this.plot.setData(heatmap, this.xAxisData, this.samplingRate, this.relative,
            this.meta.schema, this.legendPlot.colorMap, maxYAxis, this.meta.rowCount);
        this.plot.draw();
        const discrete = kindIsString(this.xAxisData.description.kind) ||
            this.xAxisData.description.kind === "Integer";

        if (this.stacked) {
            this.cdfPlot.setData(this.cdf().perBucket, discrete);
            this.cdfPlot.draw();
        }

        this.setupMouse();
        if (this.stacked)
            this.cdfDot = canvas
                .append("circle")
                .attr("r", Resolution.mouseDotRadius)
                .attr("fill", "blue");

        let pointFields;
        if (this.stacked) {
            pointFields = [this.xAxisData.getName()!,
                this.yAxisData.getName()!,
                "bucket", "y", "count", "%", "cdf"];
        } else {
            pointFields = ["bucket", this.yAxisData.getName()!, "y", "count"];
        }

        assert(this.surface != null);
        assert(this.summary != null);
        this.pointDescription = new TextOverlay(this.surface.getChart(),
            this.surface.getActualChartSize(), pointFields, 40);
        this.pointDescription.show(false);
        this.standardSummary();
        this.summary.set("buckets", bucketCount);
        this.summary.set("colors", this.yPoints);
        if (this.samplingRate < 1.0)
            this.summary.set("sampling rate", this.samplingRate);
        this.summary.setString("bar width", new HtmlString(this.xAxisData.barWidth()));
        this.addTimeSummary();
        this.summary.display();
    }

    public serialize(): IViewSerialization {
        // noinspection UnnecessaryLocalVariableJS
        const result: Histogram2DSerialization = {
            ...super.serialize(),
            samplingRate: this.samplingRate,
            relative: this.relative,
            stacked: this.stacked,
            columnDescription0: this.xAxisData.description,
            columnDescription1: this.yAxisData.description,
            xBucketCount: this.xPoints,
            yBucketCount: this.yPoints,
            xRange: this.xAxisData.dataRange,
            yRange: this.yAxisData.dataRange
        };
        return result;
    }

    public static reconstruct(ser: Histogram2DSerialization, page: FullPage): IDataView | null {
        const samplingRate: number = ser.samplingRate;
        const cd0: IColumnDescription = ser.columnDescription0;
        const cd1: IColumnDescription = ser.columnDescription1;
        const xPoints: number = ser.xBucketCount;
        const yPoints: number = ser.yBucketCount;
        const args = this.validateSerialization(ser);
        if (args == null || cd0 == null || cd1 == null || samplingRate == null ||
            xPoints == null || yPoints == null || ser.xRange == null || ser.yRange == null || ser.stacked == null)
            return null;

        const hv = new Histogram2DView(ser.remoteObjectId, args, samplingRate, page);
        hv.setAxes(new AxisData(cd0, ser.xRange, ser.xBucketCount),
            new AxisData(cd1, ser.yRange, ser.yBucketCount), ser.relative, ser.stacked);
        hv.xPoints = xPoints;
        hv.yPoints = yPoints;
        return hv;
    }

    public setAxes(xAxisData: AxisData, yAxisData: AxisData, relative: boolean, stacked: boolean): void {
        this.relative = relative;
        this.stacked = stacked;
        this.xAxisData = xAxisData;
        this.yAxisData = yAxisData;
        this.viewMenu.enable("quartiles", kindIsNumeric(this.yAxisData.description.kind));
        this.viewMenu.enable("stacked/parallel",
            kindIsString(this.yAxisData.description.kind) ||
            this.yAxisData.description.kind === "Integer"
        )
    }

    public trellis(): void {
        const columns: string[] = this.getSchema().namesExcluding(
            [this.xAxisData.description.name, this.yAxisData.description.name]);
        this.chooseTrellis(columns);
    }

    protected showTrellis(colName: string): void {
        const groupBy = this.getSchema().find(colName)!;
        const cds: IColumnDescription[] = [
            this.xAxisData.description,
            this.yAxisData.description,
            groupBy];
        const rr = this.createDataQuantilesRequest(cds, this.page, "Trellis2DHistogram");
        rr.invoke(new DataRangesReceiver(this, this.page, rr, this.meta,
            [0, 0, 0], cds, null, this.defaultProvenance,{
            reusePage: false, relative: this.relative,
            chartKind: "Trellis2DHistogram", exact: this.samplingRate >= 1.0
        }));
    }

    protected toggleStacked(): void {
        if (this.stacked) {
            // Let's see if we have enough room
            const bars = this.xPoints * (this.yAxisData.bucketCount + 1); // 1 for missing data
            if (bars * 3 > this.plot.getChartWidth()) {
                this.page.reportError("Not enough space to plot " + bars + " bars; " +
                    " consider changing the number of buckets");
                return;
            }
        }
        this.stacked = !this.stacked;
        this.resize();
    }

    protected toggleNormalize(): void {
        this.relative = !this.relative;
        if (this.relative && this.samplingRate < 1) {
            // We cannot use sampling when we display relative views.
            this.exactHistogram();
        } else {
            this.refresh();
        }
    }

    public doHeatmap(): void {
        const cds = [this.xAxisData.description, this.yAxisData.description];
        const rr = this.createDataQuantilesRequest(cds, this.page, "Heatmap");
        rr.invoke(new DataRangesReceiver(this, this.page, rr, this.meta,
            [0, 0], cds, null, this.defaultProvenance, {
            reusePage: false,
            chartKind: "Heatmap",
            exact: true
        }));
    }

    public export(): void {
        const lines: string[] =
            Exporter.histogram2DAsCsv(this.histograms(), this.getSchema(), [this.xAxisData, this.yAxisData]);
        const fileName = "histogram2d.csv";
        saveAs(fileName, lines.join("\n"));
    }

    protected getCombineRenderer(title: PageTitle):
        (page: FullPage, operation: ICancellable<RemoteObjectId>) => BaseReceiver {
        return (page: FullPage, operation: ICancellable<RemoteObjectId>) => {
            return new NewTargetReceiver(title, [this.xAxisData.description, this.yAxisData.description],
                this.meta, [0, 0], page, operation, this.dataset, {
                exact: this.samplingRate >= 1, chartKind: "2DHistogram",
                relative: this.relative, reusePage: false, stacked: this.stacked
            });
        };
    }

    public swapAxes(): void {
        if (this == null)
            return;
        const cds = [this.yAxisData.description, this.xAxisData.description];
        const rr = this.createDataQuantilesRequest(cds, this.page, "2DHistogram");
        rr.invoke(new DataRangesReceiver(this, this.page, rr, this.meta,
            [0, 0], cds, null, "swapped axes", {
            reusePage: true, relative: this.relative,
            chartKind: "2DHistogram", exact: this.samplingRate >= 1.0, stacked: this.stacked
        }));
    }

    public exactHistogram(): void {
        if (this == null)
            return;
        const cds = [this.xAxisData.description, this.yAxisData.description];
        const rr = this.createDataQuantilesRequest(cds, this.page, "2DHistogram");
        rr.invoke(new DataRangesReceiver(this, this.page, rr, this.meta,
            [this.xPoints, this.yPoints], cds, this.page.title,
            "requested exact computation", {
            reusePage: true,
            relative: this.relative,
            chartKind: "2DHistogram",
            exact: true, stacked: this.stacked
        }));
    }

    public changeBuckets(xBuckets: number | null, yBuckets: number | null): void {
        if (xBuckets == null || yBuckets == null)
            return;
        const cds = [this.xAxisData.description, this.yAxisData.description];
        const rr = this.createDataQuantilesRequest(cds, this.page, "2DHistogram");
        rr.invoke(new DataRangesReceiver(this, this.page, rr, this.meta,
            [xBuckets, yBuckets], cds, null, "changed buckets", {
            reusePage: true,
            relative: this.relative,
            chartKind: "2DHistogram",
            exact: true, stacked: this.stacked
        }));
    }

    protected replaceAxis(pageId: string, eventKind: DragEventKind): void {
        if (this.data == null)
            return;

        const sourceRange = this.getSourceAxisRange(pageId, eventKind);
        if (sourceRange == null)
            return;

        if (eventKind === "XAxis") {
            const receiver = new DataRangesReceiver(this,
                this.page, null, this.meta, [0, 0],  // any number of buckets
                [this.xAxisData.description, this.yAxisData.description], this.page.title,
                    Converters.eventToString(pageId, eventKind), {
                    chartKind: "2DHistogram", exact: this.samplingRate >= 1,
                    relative: this.relative, reusePage: true, stacked: this.stacked
                });
            receiver.run([sourceRange, this.yAxisData.dataRange]);
            receiver.finished();
        } else if (eventKind === "YAxis") {
            this.relative = false; // We cannot drag a relative Y axis.
            this.updateView(this.data, sourceRange.max!, true);
        }
    }

    public chooseBuckets(): void {
        if (this == null)
            return;

        const dialog = new Dialog("Set buckets", "Change the number of buckets.");
        let input = dialog.addTextField(
            "x_buckets", "Number of X buckets:", FieldKind.Integer,
            this.xPoints.toString(),
            "Buckets on " + this.xAxisData.description.name);
        input.min = "1";
        input.max = Resolution.maxBuckets(this.page.getWidthInPixels()).toString();
        input.value = this.xPoints.toString();
        input.required = true;

        input = dialog.addTextField(
            "y_buckets", "Number of Y buckets:", FieldKind.Integer,
            this.yPoints.toString(),
            "Buckets on " + this.yAxisData.description.name);
        input.min = "1";
        input.max = Resolution.max2DBucketCount.toString();
        input.value = this.yPoints.toString();
        input.required = true;

        dialog.setAction(() => this.changeBuckets(
            dialog.getFieldValueAsInt("x_buckets"),
            dialog.getFieldValueAsInt("y_buckets")));
        dialog.show();
    }

    public resize(): void {
        if (this.data == null)
            return;
        this.updateView(this.data, this.plot.maxYAxis, true);
    }

    public refresh(): void {
        const cds = [this.xAxisData.description, this.yAxisData.description];
        const ranges = [this.xAxisData.dataRange, this.yAxisData.dataRange];
        const receiver = new DataRangesReceiver(this,
            this.page, null, this.meta, [this.xAxisData.bucketCount, this.yAxisData.bucketCount],
            cds, this.page.title, null,{
                chartKind: "2DHistogram", exact: this.samplingRate >= 1,
                relative: this.relative, reusePage: true, stacked: this.stacked
            });
        receiver.run(ranges);
        receiver.finished();
    }

    public onMouseEnter(): void {
        super.onMouseEnter();
        if (this.stacked)
            this.cdfDot.attr("visibility", "visible");
    }

    public onMouseLeave(): void {
        if (this.stacked)
            this.cdfDot.attr("visibility", "hidden");
        super.onMouseLeave();
    }

    /**
     * Handles mouse movements in the canvas area only.
     */
    public onMouseMove(): void {
        assert(this.surface != null);
        const position = d3mouse(this.surface.getChart().node());
        // note: this position is within the chart
        const mouseX = position[0];
        const mouseY = position[1];

        const xs = this.xAxisData.invert(position[0]);
        // Use the plot scale, not the yData to invert.  That's the
        // one which is used to draw the axis.
        const y = this.plot.getYScale().invert(mouseY);
        let ys = significantDigits(y);
        if (this.relative)
            ys += "%";

        let count = "";
        let colorIndex = null;
        let bucket = "";
        let value = "";

        let pointInfo;
        if (this.stacked) {
            let box = null;
            if (mouseY >= 0 && mouseY < this.surface.getChartHeight())
                box = (this.plot as Histogram2DPlot).getBoxInfo(mouseX, y);
            let perc = 0;
            if (box != null) {
                count = significantDigits(box.count);
                colorIndex = box.yIndex;
                value = this.yAxisData.bucketDescription(colorIndex, 20);
                perc = (box.count === 0) ? 0 : box.count / box.countBelow;
                bucket = this.xAxisData.bucketDescription(box.xIndex, 20);
            }
            const pos = this.cdfPlot.getY(mouseX);
            this.cdfDot.attr("cx", mouseX + this.surface.leftMargin);
            this.cdfDot.attr("cy", (1 - pos) * this.surface.getChartHeight() + this.surface.topMargin);
            const cdf = percentString(pos);
            pointInfo = [xs, value, bucket, ys, count, percentString(perc), cdf];
        } else {
            let barInfo = null;
            if (mouseY >= 0 && mouseY < this.surface.getChartHeight())
                barInfo = (this.plot as Histogram2DBarsPlot).getBarInfo(mouseX, y);
            if (barInfo != null) {
                if (barInfo.count != null)
                    // This is null in the space between buckets.
                    count = significantDigits(barInfo.count);
                colorIndex = barInfo.colorIndex;
                value = this.yAxisData.bucketDescription(colorIndex, 20);
                bucket = this.xAxisData.bucketDescription(barInfo.bucketIndex, 20);
            }
            pointInfo = [bucket, value, ys, count];
        }

        this.pointDescription!.update(pointInfo, mouseX, mouseY);
        this.legendPlot.showBorder(colorIndex);
    }

    // Round x to align a bucket boundary.  x is a coordinate within the canvas.
    private bucketIndex(x: number): number {
        const bucketWidth = this.plot.getChartWidth() / this.xPoints;
        const index = Math.floor((x - this.surface!.leftMargin) / bucketWidth);
        if (index < 0)
            return 0;
        if (index >= this.xPoints)
            return this.xPoints - 1;
        return index;
    }

    // Returns bucket left margin in canvas.
    private bucketLeftMargin(index: number): number {
        const bucketWidth = this.plot.getChartWidth() / this.xPoints;
        return index * bucketWidth + this.surface!.leftMargin;
    }

    protected dragMove(): boolean {
        if (!super.dragMove() || this.selectionOrigin == null)
            return false;
        if (this.stacked)
            return true;

        // Mark all buckets that are selected
        const position = d3mouse(this.surface!.getCanvas().node());
        const x = position[0];
        const start = this.bucketIndex(this.selectionOrigin.x);
        const end = this.bucketIndex(x);
        const order = reorder(start, end);
        const left = this.bucketLeftMargin(order[0]);
        const right = this.bucketLeftMargin(order[1] + 1);

        this.selectionRectangle
            .attr("x", left)
            .attr("width", right - left);
        return true;
    }

    protected dragEnd(): boolean {
        if (!super.dragEnd() || this.selectionOrigin == null)
            return false;
        const position = d3mouse(this.surface!.getCanvas().node());
        let x = position[0];
        if (this.stacked) {
            this.selectionCompleted(this.selectionOrigin.x, x, false);
        } else {
            const start = this.bucketIndex(this.selectionOrigin.x);
            const end = this.bucketIndex(x);
            const order = reorder(start, end);
            const left = this.bucketLeftMargin(order[0]);
            const right = this.bucketLeftMargin(order[1] + 1);
            this.selectionCompleted(left, right, false);
        }
        return true;
    }

    /**
     * * xl and xr are coordinates of the mouse position within the
     * canvas or legend rectangle respectively.
     */
    protected selectionCompleted(xl: number, xr: number, inLegend: boolean): void {
        const shiftPressed = d3event.sourceEvent.shiftKey;
        let selectedAxis: AxisData;

        assert(this.surface != null);
        if (inLegend) {
            selectedAxis = this.yAxisData;
        } else {
            xl -= this.surface.leftMargin;
            xr -= this.surface.leftMargin;
            selectedAxis = this.xAxisData;
        }

        if (inLegend && shiftPressed) {
            let min = this.yPoints * xl / this.legendPlot.width;
            let max = this.yPoints * xr / this.legendPlot.width;
            [min, max] = reorder(min, max);
            min = Math.max(0, Math.floor(min));
            max = Math.min(this.yPoints, Math.ceil(max));

            this.legendPlot.emphasizeRange(min, max);
            const heatmap = Heatmap.create(this.data.first);
            const filter = heatmap.bucketsInRange(min, max);
            const count = filter.sum();
            assert(this.summary != null);
            this.summary.set("colors selected", max - min);
            this.summary.set("points selected", count);
            this.summary.display();
            this.resize();
            return;
        }

        const filter = selectedAxis.getFilter(xl, xr);
        const fa: RangeFilterArrayDescription = {
            filters: [filter],
            complement: d3event.sourceEvent.ctrlKey
        }
        const rr = this.createFilterRequest(fa);
        const renderer = new NewTargetReceiver(
            new PageTitle(this.page.title.format, Converters.filterArrayDescription(fa)),
            [this.xAxisData.description, this.yAxisData.description], this.meta,
            [inLegend ? this.xPoints : 0, this.yPoints], this.page, rr, this.dataset, {
            exact: this.samplingRate >= 1.0,
            chartKind: "2DHistogram",
            reusePage: false,
            relative: this.relative,
            stacked: this.stacked
        });
        rr.invoke(renderer);
    }
}

/**
 * Receives partial results and renders a 2D histogram.
 * The 2D histogram data and the Heatmap data use the same data structure.
 */
export class Histogram2DReceiver extends Receiver<Pair<Groups<Groups<number>>, Groups<number>>> {
    protected view: Histogram2DView;

    constructor(title: PageTitle,
                page: FullPage,
                protected remoteObject: TableTargetAPI,
                protected meta: TableMeta,
                protected axes: AxisData[],
                protected samplingRate: number,
                operation: RpcRequest<Pair<Groups<Groups<number>>, Groups<number>>>,
                protected options: ChartOptions) {
        super(options.reusePage ? page : page.dataset!.newPage(title, page), operation, "histogram");
        this.view = new Histogram2DView(
            this.remoteObject.getRemoteObjectId()!, meta, samplingRate, this.page);
        this.view.setAxes(axes[0], axes[1], optionToBoolean(options.relative), optionToBoolean(options.stacked));
    }

    public onNext(value: PartialResult<Pair<Groups<Groups<number>>, Groups<number>>>): void {
        super.onNext(value);
        if (value == null)
            return;
        this.view.updateView(value.data, null, false);
    }

    public onCompleted(): void {
        super.onCompleted();
        this.view.updateCompleted(this.elapsedMilliseconds());
    }
}
