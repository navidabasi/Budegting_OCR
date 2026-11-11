import { useCallback, useState } from 'react';
import { readDevice, writeDevice } from '../utils/deviceStore';

/** useState that is remembered on this device (localStorage), e.g. which Activity sections are collapsed. */
export function useDeviceState(key, initial) {
    const [value, setValue] = useState(() => readDevice(key, initial));
    const set = useCallback(
        (next) =>
            setValue((prev) => {
                const v = typeof next === 'function' ? next(prev) : next;
                writeDevice(key, v);
                return v;
            }),
        [key]
    );
    return [value, set];
}
