import type { Nullable } from "@babylonjs/core/types.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { IMaterial } from "../glTFLoaderInterfaces.js";
import type { IGLTFLoaderExtension } from "../glTFLoaderExtension.js";
import { GLTFLoader } from "../glTFLoader.js";
declare module "../../glTFFileLoader.js" {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_fuzz extension.
         */
        ["KHR_materials_fuzz"]: {};
    }
}
/**
 * [Specification]
 */
export declare class KHR_materials_fuzz implements IGLTFLoaderExtension {
    /**
     * The name of this extension.
     */
    readonly name = "KHR_materials_fuzz";
    /**
     * Defines whether this extension is enabled.
     */
    enabled: boolean;
    /**
     * Defines a number that determines the order the extensions are applied.
     */
    order: number;
    private _loader;
    /**
     * @internal
     */
    constructor(loader: GLTFLoader);
    /** @internal */
    dispose(): void;
    /**
     * @internal
     */
    loadMaterialPropertiesAsync(context: string, material: IMaterial, babylonMaterial: Material): Nullable<Promise<void>>;
    private _loadFuzzPropertiesAsync;
}
