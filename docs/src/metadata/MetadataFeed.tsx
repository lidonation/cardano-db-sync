import {createContext} from 'react';
import type {UpdatesFeed} from '../updates/types';

/** A page-owned DataFeed snapshot for Metadata, kept out of site-wide global data. */
export const MetadataFeed = createContext<UpdatesFeed | undefined>(undefined);
