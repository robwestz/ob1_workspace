import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import {
  StatCard,
  Badge,
  StatusBadge,
  DataTable,
  EmptyState,
  Skeleton,
  SkeletonCard,
  SkeletonRow,
  FullPageSpinner,
} from '../ui';
import type { BadgeVariant, Column } from '../ui';
import { Activity, AlertCircle, Inbox } from 'lucide-react';

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

describe('StatCard', () => {
  it('renders the value and label', () => {
    render(<StatCard icon={Activity} label="Total Thoughts" value={1234} />);
    expect(screen.getByText('Total Thoughts')).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument();
  });

  it('renders a string value', () => {
    render(<StatCard icon={Activity} label="Status" value="Healthy" />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders a subtitle when provided and no trend', () => {
    render(
      <StatCard
        icon={Activity}
        label="Memory"
        value={42}
        subtitle="since last week"
      />,
    );
    expect(screen.getByText('since last week')).toBeInTheDocument();
  });

  it('renders trend info when provided', () => {
    render(
      <StatCard
        icon={Activity}
        label="Thoughts"
        value={10}
        trend={{ direction: 'up', label: '+5 today' }}
      />,
    );
    expect(screen.getByText('+5 today')).toBeInTheDocument();
  });

  it('applies the specified color theme class', () => {
    const { container } = render(
      <StatCard icon={Activity} label="Cost" value="$0.50" color="red" />,
    );
    // The outer div should contain the red glow hover class
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('hover:shadow-red-500/5');
  });

  it('applies custom className', () => {
    const { container } = render(
      <StatCard
        icon={Activity}
        label="Test"
        value={0}
        className="my-custom-class"
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('my-custom-class');
  });
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

describe('Badge', () => {
  const variants: BadgeVariant[] = [
    'running',
    'completed',
    'failed',
    'pending',
    'cancelled',
    'timeout',
    'info',
    'warning',
    'success',
    'error',
    'neutral',
  ];

  it('renders children text', () => {
    render(<Badge variant="info">Test Label</Badge>);
    expect(screen.getByText('Test Label')).toBeInTheDocument();
  });

  it.each(variants)('renders with variant "%s" without crashing', (variant) => {
    const { container } = render(
      <Badge variant={variant}>{variant}</Badge>,
    );
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it('applies ring-1 base class for all variants', () => {
    const { container } = render(
      <Badge variant="running">Running</Badge>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('ring-1');
  });

  it('shows pulse dot when pulse=true', () => {
    const { container } = render(
      <Badge variant="running" pulse>
        Running
      </Badge>,
    );
    // pulse creates a span with animate-ping class
    const pulseDot = container.querySelector('.animate-ping');
    expect(pulseDot).toBeInTheDocument();
  });

  it('does not show pulse dot by default', () => {
    const { container } = render(
      <Badge variant="completed">Done</Badge>,
    );
    const pulseDot = container.querySelector('.animate-ping');
    expect(pulseDot).not.toBeInTheDocument();
  });

  it('applies md size classes when size="md"', () => {
    const { container } = render(
      <Badge variant="info" size="md">
        Medium
      </Badge>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('px-2.5');
    expect(el.className).toContain('text-xs');
  });

  it('applies sm size classes by default', () => {
    const { container } = render(
      <Badge variant="info">Small</Badge>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('px-2');
    expect(el.className).toContain('text-[11px]');
  });
});

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('shows pulse dot for running status', () => {
    const { container } = render(<StatusBadge status="running" />);
    const pulseDot = container.querySelector('.animate-ping');
    expect(pulseDot).toBeInTheDocument();
  });

  it('falls back to neutral variant for unknown status', () => {
    const { container } = render(<StatusBadge status="unknown_status" />);
    expect(screen.getByText('unknown_status')).toBeInTheDocument();
    // neutral variant has slate-500 in its classes
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('ring-slate-500');
  });
});

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

interface TestRow {
  id: string;
  name: string;
  status: string;
  count: number;
}

const testColumns: Column<TestRow>[] = [
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
  { key: 'count', header: 'Count', align: 'right' },
];

const testData: TestRow[] = [
  { id: '1', name: 'Alice', status: 'active', count: 10 },
  { id: '2', name: 'Bob', status: 'inactive', count: 5 },
  { id: '3', name: 'Charlie', status: 'active', count: 20 },
];

describe('DataTable', () => {
  it('renders column headers', () => {
    render(
      <DataTable columns={testColumns} data={testData} rowKey="id" />,
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
  });

  it('renders all data rows', () => {
    render(
      <DataTable columns={testColumns} data={testData} rowKey="id" />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('renders cell values as strings', () => {
    render(
      <DataTable columns={testColumns} data={testData} rowKey="id" />,
    );
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('shows empty message when data is empty', () => {
    render(
      <DataTable
        columns={testColumns}
        data={[]}
        rowKey="id"
        emptyMessage="Nothing here"
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('shows default empty message when none provided', () => {
    render(
      <DataTable columns={testColumns} data={[]} rowKey="id" />,
    );
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('renders custom cell via render function', () => {
    const columnsWithRender: Column<TestRow>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (row) => <strong data-testid="bold-name">{row.name}</strong>,
      },
    ];
    render(
      <DataTable
        columns={columnsWithRender}
        data={[testData[0]]}
        rowKey="id"
      />,
    );
    const el = screen.getByTestId('bold-name');
    expect(el.tagName).toBe('STRONG');
    expect(el).toHaveTextContent('Alice');
  });

  it('shows search input when searchable=true', () => {
    render(
      <DataTable
        columns={testColumns}
        data={testData}
        rowKey="id"
        searchable
        searchPlaceholder="Find user..."
      />,
    );
    expect(screen.getByPlaceholderText('Find user...')).toBeInTheDocument();
  });

  it('does not show search input by default', () => {
    render(
      <DataTable columns={testColumns} data={testData} rowKey="id" />,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders correct number of table rows (excluding header)', () => {
    const { container } = render(
      <DataTable columns={testColumns} data={testData} rowKey="id" />,
    );
    const tbody = container.querySelector('tbody');
    expect(tbody?.querySelectorAll('tr')).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

describe('EmptyState', () => {
  it('renders the message text', () => {
    render(<EmptyState message="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders the title when provided', () => {
    render(
      <EmptyState title="Empty" message="Nothing to show" />,
    );
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });

  it('does not render a title element when title is not provided', () => {
    const { container } = render(
      <EmptyState message="No items" />,
    );
    expect(container.querySelector('h3')).not.toBeInTheDocument();
  });

  it('renders an action element when provided', () => {
    render(
      <EmptyState
        message="No data"
        action={<button>Retry</button>}
      />,
    );
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('renders the default Inbox icon when no icon is specified', () => {
    const { container } = render(<EmptyState message="Empty" />);
    // Lucide icons render as SVGs
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders a custom icon', () => {
    const { container } = render(
      <EmptyState icon={AlertCircle} message="Error state" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <EmptyState message="Test" className="extra-class" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('extra-class');
  });
});

// ---------------------------------------------------------------------------
// Loading components
// ---------------------------------------------------------------------------

describe('Skeleton', () => {
  it('renders with aria-hidden', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies custom className', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('h-4');
    expect(el.className).toContain('w-32');
  });

  it('includes skeleton base class', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('skeleton');
  });
});

describe('SkeletonCard', () => {
  it('renders a card-shaped skeleton with inner placeholders', () => {
    const { container } = render(<SkeletonCard />);
    // Should contain multiple skeleton divs inside
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SkeletonRow', () => {
  it('renders the default number of skeleton columns (4)', () => {
    const { container } = render(<SkeletonRow />);
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons).toHaveLength(4);
  });

  it('renders specified number of columns', () => {
    const { container } = render(<SkeletonRow cols={6} />);
    const skeletons = container.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons).toHaveLength(6);
  });
});

describe('FullPageSpinner', () => {
  it('renders with "Loading..." text', () => {
    render(<FullPageSpinner />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders the spinning animation element', () => {
    const { container } = render(<FullPageSpinner />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });
});
