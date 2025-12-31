import type { Nullable } from "@babylonjs/core/types.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { IMaterial } from "../glTFLoaderInterfaces.js";
import type { IGLTFLoaderExtension } from "../glTFLoaderExtension.js";
import { GLTFLoader } from "../glTFLoader.js";
declare module "../../glTFFileLoader.js" {
    interface GLTFLoaderExtensionOptions {
        /**
         * Defines options for the KHR_materials_coat extension.
         */
        ["KHR_materials_coat"]: {};
    }
}
/**
 * [Specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_coat/README.md)
 * [Playground Sample](https://www.babylonjs-playground.com/frame.html#7F7PN6#8)
 */
export declare class KHR_materials_coat implements IGLTFLoaderExtension {
    /**
     * The name of this extension.
     */
    readonly name = "KHR_materials_coat";
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
     * Defines whether the KHR_materials_openpbr extension is used, indicating that
     * the material should be interpreted as OpenPBR (for coat, this might be necessary
     * to interpret anisotropy correctly).
     */
    private useOpenPBR;
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
    private _loadCoatPropertiesAsync;
}
