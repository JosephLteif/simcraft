import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import UpgradePlan, { type UpgradePlanCandidate } from './UpgradePlan';
import { WISHLIST_STORAGE_KEY } from '../lib/wishlist';

const candidate: UpgradePlanCandidate = {
  uid: 'head-1',
  slot: 'head',
  item_id: 1,
  ilevel: 600,
  target_ilevel: 632,
  costs: { '3008': 15 },
  discounted: false,
};

const props = {
  storageKey: 'whylowdps_upgrade_plan:test',
  wishlistOwnerKey: 'us:test-realm:test',
  candidates: [candidate],
  selectedUids: new Set([candidate.uid]),
  itemInfo: { 1: { name: 'Test Helm', icon: 'inv_helmet' } },
  currencies: {
    '3008': { id: 3008, amount: 20, name: 'Valorstone', icon: 'inv_currency_crest' },
  },
  effectiveCurrencies: {
    '3008': { id: 3008, amount: 20, name: 'Valorstone', icon: 'inv_currency_crest' },
  },
};

describe('UpgradePlan', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('adds selected candidates and tracks completion against the budget', () => {
    render(<UpgradePlan {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add selected (1)' }));

    expect(screen.getByText('Test Helm')).toBeInTheDocument();
    expect(screen.getByText('0/1 complete')).toBeInTheDocument();
    expect(screen.getByText('15 / 20')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark upgrade complete' }));

    expect(screen.getByRole('button', { name: 'Mark upgrade incomplete' })).toBeInTheDocument();
    expect(screen.getByText('1/1 complete')).toBeInTheDocument();
  });

  it('restores and removes a saved plan entry', () => {
    window.localStorage.setItem(
      props.storageKey,
      JSON.stringify([{ uid: candidate.uid, completed: true }])
    );

    render(<UpgradePlan {...props} />);

    expect(screen.getByText('Test Helm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark upgrade incomplete' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove upgrade from plan' }));

    expect(screen.queryByText('Test Helm')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(props.storageKey)).toBe('[]');
  });

  it('summarizes the matching character wishlist without copying it into the plan', () => {
    window.localStorage.setItem(
      WISHLIST_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        by_owner: {
          [props.wishlistOwnerKey]: [{ item_id: 2, name: 'Wishlist Shoulders' }],
        },
      })
    );

    render(<UpgradePlan {...props} />);

    expect(screen.getByText('1 item to acquire before upgrading.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Wishlist' })).toHaveAttribute(
      'href',
      '/wishlist?owner=us%3Atest-realm%3Atest'
    );
    expect(screen.getByRole('link', { name: 'Drop Finder' })).toHaveAttribute(
      'href',
      '/drop-finder'
    );
    expect(screen.getByRole('link', { name: 'below' })).toHaveAttribute(
      'href',
      '#upgradeable-items'
    );
    expect(screen.queryByText('Wishlist Shoulders')).not.toBeInTheDocument();
  });
});
