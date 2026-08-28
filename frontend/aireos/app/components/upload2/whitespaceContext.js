'use client';

import { createContext, useContext } from 'react';

// Whether column names should render invisible characters (space, tab) as
// visible glyphs. Provided at the harness root, read only by <ColumnName>.
const WhitespaceContext = createContext(false);

export const WhitespaceProvider = WhitespaceContext.Provider;
export const useShowWhitespace = () => useContext(WhitespaceContext);