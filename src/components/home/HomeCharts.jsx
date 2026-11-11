import { useMemo } from 'react';
import { Doughnut, Line } from 'react-chartjs-2';
import { ArcElement, CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import { Card } from '../ui';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../languages/useTranslation';
import { monthLabel, useMoney } from '../../hooks/useMoney';
import { categoryColor } from '../../utils/categoryColors';
import { addMonths } from '../../utils/monthMath';
import { cumulativeSpend, spentByCategory } from '../../utils/money';
import { monthProgress } from '../../utils/monthMath';

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

/** Category donut and cumulative month-vs-last-month line. Loaded lazily (chart.js stays out of the main bundle). */
export default function HomeCharts({ transactions, trips, month, today, customColors }) {
    const { t, languageCode, localizeCategory } = useTranslation();
    const { num } = useMoney();
    const dark = useAppStore((s) => s.darkMode);
    const ink = dark ? '#E7EEE9' : '#10211B';
    const muted = dark ? '#9FB0A7' : '#5C6B64';
    const grid = dark ? 'rgba(255,255,255,.08)' : 'rgba(16,33,27,.08)';

    const cats = useMemo(
        () => Object.entries(spentByCategory(transactions, month, { trips, includeTrips: true })).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
        [transactions, month, trips]
    );
    const total = cats.reduce((s, [, v]) => s + v, 0);
    const progress = monthProgress(month, today);
    const prev = addMonths(month, -1);
    const thisSeries = useMemo(() => cumulativeSpend(transactions, month, { upToDay: progress.state === 'current' ? progress.day : undefined }), [transactions, month, progress.day, progress.state]);
    const prevSeries = useMemo(() => cumulativeSpend(transactions, prev), [transactions, prev]);
    const days = Math.max(thisSeries.length, prevSeries.length, progress.days);

    return (
        <div className="flex flex-col gap-3">
            {cats.length > 0 ? (
                <Card className="!rounded-[20px] flex flex-col gap-3" data-testid="category-donut">
                    <h2 className="font-display text-[17px] font-bold text-ink">{t('home.whereItWent')}</h2>
                    <div className="mx-auto h-44 w-44" role="img" aria-label={t('home.whereItWent')}>
                        <Doughnut
                            data={{ labels: cats.map(([c]) => localizeCategory(c)), datasets: [{ data: cats.map(([, v]) => v), backgroundColor: cats.map(([c]) => categoryColor(c, dark, customColors?.[c])), borderWidth: 0 }] }}
                            options={{ cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${num(c.parsed)}` } } }, maintainAspectRatio: false }}
                        />
                    </div>
                    <ul className="flex flex-col">
                        {cats.slice(0, 6).map(([c, v]) => (
                            <li key={c} className="flex items-center gap-2.5 py-1.5 text-sm text-ink">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: categoryColor(c, dark, customColors?.[c]) }} aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate">{localizeCategory(c)}</span>
                                <span className="mono-num text-ink-muted">{Math.round((v / total) * 100)}%</span>
                                <span className="mono-num w-20 text-end">{num(v)}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            ) : null}
            {thisSeries.length > 0 ? (
                <Card className="!rounded-[20px] flex flex-col gap-2" data-testid="month-line">
                    <h2 className="font-display text-[17px] font-bold text-ink">{t('home.monthVsLast')}</h2>
                    <div className="h-48" role="img" aria-label={t('home.monthVsLast')}>
                        <Line
                            data={{
                                labels: Array.from({ length: days }, (_, i) => i + 1),
                                datasets: [
                                    { label: monthLabel(month, languageCode), data: thisSeries, borderColor: dark ? '#4FD19B' : '#00573F', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.2 },
                                    { label: monthLabel(prev, languageCode), data: prevSeries, borderColor: muted, backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.2 },
                                ],
                            }}
                            options={{
                                maintainAspectRatio: false,
                                interaction: { mode: 'index', intersect: false },
                                plugins: { legend: { position: 'bottom', labels: { color: ink, boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${num(c.parsed.y)}` } } },
                                scales: { x: { ticks: { color: muted, maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { color: muted, maxTicksLimit: 4 }, grid: { color: grid }, beginAtZero: true } },
                            }}
                        />
                    </div>
                </Card>
            ) : null}
        </div>
    );
}
