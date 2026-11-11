/** A labelled on/off switch row (Settings). `hint` is the secondary line. */
export default function ToggleRow({ label, hint, checked, onChange, testId }) {
    return (
        <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-gray-900 dark:text-white">{label}</span>
                {hint ? <span className="text-xs text-gray-600 dark:text-gray-400">{hint}</span> : null}
            </span>
            <input type="checkbox" role="switch" data-testid={testId} checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-gray-300 transition-colors checked:bg-primary-500 dark:bg-gray-600 relative before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5" />
        </label>
    );
}
