import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import InlineChart from './InlineChart';

describe('InlineChart', () => {
  it('renders one bar per data pair for the { data: [{x,y}] } shape', () => {
    const { container } = render(
      <InlineChart spec={{ type: 'bar', data: [{ x: 'Q1', y: 10 }, { x: 'Q2', y: 20 }] }} />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('renders a polyline and one point per datum for line charts', () => {
    const { container } = render(
      <InlineChart spec={{ type: 'line', data: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }, { x: 'c', y: 3 }] }} />,
    );
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(container.querySelectorAll('circle')).toHaveLength(3);
  });

  it('accepts the { labels, values } shape', () => {
    const { container } = render(
      <InlineChart spec={{ type: 'bar', labels: ['a', 'b', 'c'], values: [1, 2, 3] }} />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(3);
  });

  it('accepts the { series: [{ data }] } shape', () => {
    const { container } = render(
      <InlineChart spec={{ type: 'bar', series: [{ data: [{ x: 'a', y: 1 }] }] }} />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(1);
  });

  it('renders without bars when the spec has no recognizable data', () => {
    const { container } = render(<InlineChart spec={{}} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('rect')).toHaveLength(0);
  });

  it('shows the title when provided', () => {
    const { getByText } = render(
      <InlineChart spec={{ title: 'Quarterly Sales', type: 'bar', data: [{ x: 'Q1', y: 1 }] }} />,
    );
    expect(getByText('Quarterly Sales')).toBeTruthy();
  });
});
