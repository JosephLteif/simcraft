import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResultInsights from './ResultInsights';

describe('ResultInsights', () => {
  it('starts closed and reveals the analysis on demand', () => {
    render(<ResultInsights dps={1000} dpsError={100} iterations={10_000} />);

    const toggle = screen.getByRole('button', { name: /Result Insights/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('img', { name: /Estimated DPS distribution/i })
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('img', { name: /Estimated DPS distribution/i })).toBeInTheDocument();
  });
});
