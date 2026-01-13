import {
  createVerifyWorkflow as createVerifyWorkflowGeneric,
  getPackages as getPackagesGeneric,
  getSubResources as getSubResourcesGeneric,
  registerResourceInReleasePlease,
  removeResourceFromReleasePlease,
  removeVerifyWorkflow as removeVerifyWorkflowGeneric,
  selectPackage as selectPackageGeneric,
} from './resource-utils.js';

export async function getPackages(): Promise<string[]> {
  return getPackagesGeneric('action');
}

export async function getSubActions(packageName: string): Promise<string[]> {
  return getSubResourcesGeneric('action', packageName);
}

export async function selectPackage(allowCreate = false): Promise<string> {
  return selectPackageGeneric('action', allowCreate);
}

// Release Please Helpers
export async function registerActionInReleasePlease(packageName: string, subAction: string) {
  return registerResourceInReleasePlease('action', packageName, subAction);
}

export async function removeActionFromReleasePlease(packageName: string, subAction: string) {
  return removeResourceFromReleasePlease('action', packageName, subAction);
}

// Verify Workflow Helpers
export async function createVerifyWorkflow(packageName: string, subAction: string) {
  return createVerifyWorkflowGeneric('action', packageName, subAction);
}

export async function removeVerifyWorkflow(packageName: string, subAction: string) {
  return removeVerifyWorkflowGeneric('action', packageName, subAction);
}
