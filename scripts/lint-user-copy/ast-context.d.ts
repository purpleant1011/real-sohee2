import type ts from 'typescript'

export function isUiName(name: string | null | undefined): boolean
export function isUiJsxAttr(attrName: string | null | undefined): boolean
export function isLabelMapName(name: string): boolean
export function propertyNameText(nameNode: ts.Node | undefined): string | null
export function enclosingFunctionName(node: ts.Node): string | null
export function isCodeContext(node: ts.Node): boolean
export function isValidationIssueCode(prop: ts.PropertyAssignment): boolean
export function isLlmInstructionContext(node: ts.Node): boolean
export function hasHangul(text: string): boolean

export interface CopyLeaf {
  node: ts.Node
  kind: string
  texts: Array<{ node: ts.Node; text: string; offset: number; abs?: number }>
}

export function collectCopyLeaves(expr: ts.Expression, kindPrefix?: string): CopyLeaf[]
