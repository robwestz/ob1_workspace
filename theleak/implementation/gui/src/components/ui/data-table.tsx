'use client';

import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: string;
  /** Render a custom cell; receives the full row */
  render?: (row: T) => React.ReactNode;
  /** Enable sorting (default true if no render) */
  sortable?: boolean;
  /** Accessor for sorting when using render */
  sortValue?: (row: T) => string | number;
  /** Column width class */
  width?: string;
  /** Alignment */
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps<T extends Record<string, any>> {
  columns: Column<T>[];
  data: T[];
  /** Unique key field on each row */
  rowKey: keyof T;
  /** Enable the search box */
  searchable?: boolean;
  /** Placeholder text for search */
  searchPlaceholder?: string;
  /** Fields to search in (defaults to all string columns) */
  searchFields?: (keyof T)[];
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Empty message */
  emptyMessage?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  rowKey,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchFields,
  onRowClick,
  emptyMessage = 'No data available',
  className = '',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');

  // Filtered data
  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    const fields = searchFields ?? columns.map((c) => c.key as keyof T);
    return data.filter((row) =>
      fields.some((f) => {
        const v = row[f];
        return v != null && String(v).toLowerCase().includes(q);
      }),
    );
  }, [data, search, searchFields, columns]);

  // Sorted data
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;

    const getValue = col.sortValue ?? ((row: T) => row[sortKey] ?? '');

    return [...filtered].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, columns]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortKey !== colKey) return <ChevronsUpDown size={12} className="text-slate-600" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-blue-400" />
    ) : (
      <ChevronDown size={12} className="text-blue-400" />
    );
  };

  return (
    <div className={className}>
      {searchable && (
        <div className="relative mb-4">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-700
              bg-slate-800/60 text-slate-200 placeholder:text-slate-500
              focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/30
              transition-colors"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/80">
              {columns.map((col) => {
                const sortable = col.sortable !== false;
                const alignClass =
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                      ? 'text-center'
                      : 'text-left';
                return (
                  <th
                    key={col.key}
                    className={[
                      'px-4 py-3 font-medium text-xs text-slate-400 uppercase tracking-wider',
                      sortable ? 'cursor-pointer select-none hover:text-slate-300' : '',
                      alignClass,
                      col.width ?? '',
                    ].join(' ')}
                    onClick={sortable ? () => handleSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {col.header}
                      {sortable && <SortIcon colKey={col.key} />}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-slate-500 text-sm"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr
                  key={String(row[rowKey])}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={[
                    'transition-colors duration-100',
                    onRowClick
                      ? 'cursor-pointer hover:bg-slate-800/50'
                      : 'hover:bg-slate-800/30',
                  ].join(' ')}
                >
                  {columns.map((col) => {
                    const alignClass =
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left';
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-slate-300 ${alignClass} ${col.width ?? ''}`}
                      >
                        {col.render ? col.render(row) : String(row[col.key] ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
