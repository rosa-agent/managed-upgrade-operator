import { type EncodedExtension } from '@openshift-console/dynamic-plugin-sdk/lib/types';
import { type ConsolePage, type HrefNavItem } from '@openshift-console/dynamic-plugin-sdk';

const extensions: EncodedExtension[] = [
  {
    type: 'console.page/route',
    properties: {
      path: '/preflight-checks',
      component: { $codeRef: 'PreflightCheckPage' },
    },
  } as EncodedExtension<ConsolePage>,
  {
    type: 'console.navigation/href',
    properties: {
      id: 'preflight-checks',
      name: 'Preflight Checks',
      href: '/preflight-checks',
      perspective: 'admin',
      section: 'administration',
      insertAfter: 'cluster-settings',
    },
  } as EncodedExtension<HrefNavItem>,
];

export default extensions;
