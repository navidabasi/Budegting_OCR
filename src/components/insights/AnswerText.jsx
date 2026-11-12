// An assistant answer as paragraphs and lists: the model writes plain text, with list lines starting "- ", "• ", "* " or "1. ".
// Consecutive list lines become one <ul> / <ol>; everything else stays a paragraph. No markdown beyond that, no HTML.
const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;

/** text -> [{ type: 'p' | 'ul' | 'ol', lines: string[] }] */
export function answerBlocks(text) {
    const blocks = [];
    for (const raw of String(text || '').split('\n')) {
        const b = BULLET.exec(raw);
        const n = b ? null : NUMBERED.exec(raw);
        const type = b ? 'ul' : n ? 'ol' : 'p';
        const line = b ? b[1] : n ? n[1] : raw;
        if (type === 'p' && !line.trim()) {
            blocks.push({ type: 'gap', lines: [] });
            continue;
        }
        const last = blocks[blocks.length - 1];
        if (last && last.type === type && type !== 'p') last.lines.push(line);
        else blocks.push({ type, lines: [line] });
    }
    return blocks.filter((x, i, all) => x.type !== 'gap' || (i > 0 && i < all.length - 1));
}

export default function AnswerText({ text, className = '' }) {
    const blocks = answerBlocks(text);
    if (blocks.every((b) => b.type === 'p' || b.type === 'gap')) return <p className={`whitespace-pre-wrap ${className}`}>{text}</p>;
    return (
        <div className={`flex flex-col gap-1.5 ${className}`} data-testid="answer-text">
            {blocks.map((b, i) => {
                if (b.type === 'gap') return null;
                if (b.type === 'p') return <p key={i}>{b.lines.join('\n')}</p>;
                const List = b.type === 'ol' ? 'ol' : 'ul';
                return (
                    <List key={i} className={`flex flex-col gap-0.5 ps-5 ${b.type === 'ol' ? 'list-decimal' : 'list-disc'} marker:text-ink-muted`}>
                        {b.lines.map((l, j) => (
                            <li key={j}>{l}</li>
                        ))}
                    </List>
                );
            })}
        </div>
    );
}
