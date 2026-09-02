import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CharacterQuickLinks from './CharacterQuickLinks';

describe('CharacterQuickLinks', () => {
  it('provides consistent accessible labels for character profile links', () => {
    render(
      <CharacterQuickLinks
        armoryUrl="https://example.com/armory"
        warcraftLogsUrl="https://example.com/logs"
        raiderIoUrl="https://example.com/raider"
        characterLabel="O'Neil - Aerie Peak"
      />
    );

    expect(
      screen.getByRole('link', { name: "Open Official Armory for O'Neil - Aerie Peak" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: "Open Warcraft Logs profile for O'Neil - Aerie Peak" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: "Open Raider.IO profile for O'Neil - Aerie Peak" })
    ).toBeInTheDocument();
  });
});
