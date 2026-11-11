import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NarrativeCard from '../NarrativeCard';

const data = { headline: 'Dining is pushing you over', summary: 'You spent 1.240 € in 10 days.', wins: ['Groceries fine'], concerns: [], actions: [], model: 'deepseek-chat', generatedAt: '2026-11-10T09:12:00Z' };

afterEach(cleanup);
describe('NarrativeCard', () => {
    it('shows the narrative with the privacy line and model', () => {
        render(<NarrativeCard status="ready" data={data} onRetry={() => {}} />);
        expect(screen.getByText('Dining is pushing you over')).toBeTruthy();
        expect(screen.getByText(/Made from your monthly totals only · deepseek-chat/)).toBeTruthy();
    });
    it('offline without a narrative asks to connect', () => {
        const retry = vi.fn();
        render(<NarrativeCard status="offline" data={null} onRetry={retry} />);
        expect(screen.getByText('Connect to generate')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(retry).toHaveBeenCalled();
    });
    it('503 llm_not_configured', () => {
        render(<NarrativeCard status="notConfigured" data={null} onRetry={() => {}} />);
        expect(screen.getByText('AI isn’t set up yet')).toBeTruthy();
    });
    it('rate limit and error offer a retry', () => {
        render(<NarrativeCard status="rateLimit" data={null} onRetry={() => {}} />);
        expect(screen.getByText(/Daily AI limit/)).toBeTruthy();
    });
    it('keeps the old narrative visible while refreshing', () => {
        render(<NarrativeCard status="loading" data={data} onRetry={() => {}} />);
        expect(screen.getByText('Dining is pushing you over')).toBeTruthy();
    });
});
