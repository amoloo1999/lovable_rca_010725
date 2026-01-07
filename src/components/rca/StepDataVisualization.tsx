import { useState } from 'react';
import { FileDown, Table2, BarChart3, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Store, AdjustmentFactors, RateRecord, FeatureCode } from '@/types/rca';

interface StepDataVisualizationProps {
  subjectStore: Store | null;
  selectedStores: Store[];
  adjustmentFactors: AdjustmentFactors;
  rateRecords: RateRecord[];
  customNames: Record<number, string>;
  featureCodes: FeatureCode[];
  onExport: () => void;
  isLoading: boolean;
  onBack: () => void;
}

type SortField = 'storeName' | 'size' | 'walkInPrice' | 'onlinePrice' | 'date';
type SortDirection = 'asc' | 'desc';

export function StepDataVisualization({ 
  subjectStore, 
  selectedStores, 
  adjustmentFactors, 
  rateRecords,
  customNames,
  featureCodes,
  onExport, 
  isLoading, 
  onBack 
}: StepDataVisualizationProps) {
  const [filterStore, setFilterStore] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('storeName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const totalAdjustment = 
    (adjustmentFactors.captiveMarketPremium || 0) + 
    (adjustmentFactors.lossToLease || 0) + 
    (adjustmentFactors.ccAdj || 0);

  // Apply custom names to records
  const recordsWithNames = rateRecords.map((record) => ({
    ...record,
    displayName: customNames[record.storeId] || record.storeName,
  }));

  // Filter records
  const filteredRecords = filterStore === 'all' 
    ? recordsWithNames 
    : recordsWithNames.filter(r => r.storeId.toString() === filterStore);

  // Sort records
  const sortedRecords = [...filteredRecords].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'storeName':
        comparison = a.displayName.localeCompare(b.displayName);
        break;
      case 'size':
        comparison = (a.size || '').localeCompare(b.size || '');
        break;
      case 'walkInPrice':
        comparison = (a.walkInPrice || 0) - (b.walkInPrice || 0);
        break;
      case 'onlinePrice':
        comparison = (a.onlinePrice || 0) - (b.onlinePrice || 0);
        break;
      case 'date':
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? 
      <ChevronUp className="w-4 h-4 inline ml-1" /> : 
      <ChevronDown className="w-4 h-4 inline ml-1" />;
  };

  const formatCurrency = (value?: number) => {
    if (value === undefined || value === null) return '-';
    return `$${value.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Get feature code for a record
  const getFeatureCode = (record: RateRecord) => {
    const tag = record.tag || record.unitType;
    const fc = featureCodes.find(f => f.originalTag === tag);
    return fc?.code || tag?.slice(0, 4).toUpperCase() || '-';
  };

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Data Visualization</h2>
        <p className="text-muted-foreground">
          Review your rate data before exporting to CSV
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Subject Store</div>
            <div className="font-semibold truncate">{subjectStore?.storeName || 'Not selected'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Competitors</div>
            <div className="font-semibold">{selectedStores.length - 1} stores</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Total Records</div>
            <div className="font-semibold">{rateRecords.length.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Total Adjustment</div>
            <div className="font-semibold font-mono">{totalAdjustment.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Data Table */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Table2 className="w-5 h-5" />
                Rate Data Preview
              </CardTitle>
              <CardDescription>
                Showing {sortedRecords.length} of {rateRecords.length} records
              </CardDescription>
            </div>
            <Select value={filterStore} onValueChange={setFilterStore}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {selectedStores.map((store) => (
                  <SelectItem key={store.storeId} value={store.storeId.toString()}>
                    {customNames[store.storeId] || store.storeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {rateRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No rate data available yet.</p>
              <p className="text-sm mt-1">Data will be fetched when you export.</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('storeName')}
                    >
                      Store Name <SortIcon field="storeName" />
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('size')}
                    >
                      Size <SortIcon field="size" />
                    </TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Features</TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('walkInPrice')}
                    >
                      Walk-in <SortIcon field="walkInPrice" />
                    </TableHead>
                    <TableHead 
                      className="text-right cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('onlinePrice')}
                    >
                      Online <SortIcon field="onlinePrice" />
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('date')}
                    >
                      Date <SortIcon field="date" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRecords.slice(0, 100).map((record, idx) => (
                    <TableRow key={`${record.storeId}-${record.date}-${record.size}-${idx}`}>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {record.displayName}
                      </TableCell>
                      <TableCell>{record.size}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {getFeatureCode(record)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[150px]">
                        <div className="flex flex-wrap gap-1">
                          {record.climateControlled && (
                            <Badge variant="secondary" className="text-xs">CC</Badge>
                          )}
                          {record.driveUp && (
                            <Badge variant="secondary" className="text-xs">DU</Badge>
                          )}
                          {record.elevator && (
                            <Badge variant="secondary" className="text-xs">EL</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(record.walkInPrice)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(record.onlinePrice)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(record.date)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {sortedRecords.length > 100 && (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  Showing first 100 records. Export CSV for complete data.
                </div>
              )}
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="w-5 h-5" />
            Export to CSV
          </CardTitle>
          <CardDescription>
            Download your analysis as CSV files
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium">Full Data Dump</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Complete rate records with all details
              </p>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium">Summary Report</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Grouped averages with T-period calculations
              </p>
            </div>
          </div>

          <Button onClick={onExport} disabled={isLoading} className="w-full" size="lg">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Reports...
              </>
            ) : (
              <>
                <FileDown className="mr-2 h-4 w-4" />
                Export CSV Reports
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button variant="ghost" onClick={() => window.location.reload()}>
          Start New Analysis
        </Button>
      </div>
    </div>
  );
}
