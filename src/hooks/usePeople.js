import { useCallback, useMemo } from 'react';
import { useUserPrefs } from './useUserPrefs';
import { addPerson } from '../utils/splits';

/** The people expenses are shared with (no accounts needed), kept in the synced prefs: { people, add(name) -> person, rename(id, name), remove(id) }. */
export function usePeople() {
    const { prefs, setPrefs } = useUserPrefs();
    const people = useMemo(() => (Array.isArray(prefs.people) ? prefs.people.filter((p) => p?.id && p?.name) : []), [prefs.people]);
    const add = useCallback(
        async (name) => {
            const r = addPerson(people, name);
            if (r.person && r.people !== people) await setPrefs({ people: r.people });
            return r.person;
        },
        [people, setPrefs]
    );
    const rename = useCallback((id, name) => setPrefs({ people: people.map((p) => (p.id === id ? { ...p, name: String(name).trim() || p.name } : p)) }), [people, setPrefs]);
    const remove = useCallback((id) => setPrefs({ people: people.filter((p) => p.id !== id) }), [people, setPrefs]); // past splits keep the name they were saved with
    return { people, add, rename, remove };
}
