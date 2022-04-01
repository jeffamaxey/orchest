import { Code } from "@/components/common/Code";
import { Step } from "@/types";
import {
  ALLOWED_STEP_EXTENSIONS,
  extensionFromFilename,
  fetcher,
} from "@orchest/lib-utils";
import React from "react";
import { FileManagerRoot } from "../common";

export type FileTrees = Record<string, TreeNode>;

export const FILE_MANAGEMENT_ENDPOINT = "/async/file-management";
export const FILE_MANAGER_ROOT_CLASS = "file-manager-root";
export const ROOT_SEPARATOR = ":";

export const treeRoots: FileManagerRoot[] = ["/project-dir", "/data"];

export type TreeNode = {
  children: TreeNode[];
  path: string;
  type: "directory" | "file";
  name: string;
  root: boolean;
};

export const searchTree = (
  path: string,
  tree: TreeNode,
  res: { parent?: TreeNode; node?: TreeNode } = {}
) => {
  // This search returns early
  for (let x = 0; x < tree.children.length; x++) {
    let node = tree.children[x];
    if (node.path === path) {
      res.parent = tree;
      res.node = node;
      break;
    } else if (node.children) {
      searchTree(path, node, res);
    }
  }
  return res;
};

export const unpackCombinedPath = (combinedPath: string) => {
  // combinedPath includes the root
  // e.g. /project-dir:/abc/def
  // Note, the root can't contain the special character ':'
  let root = combinedPath.split(ROOT_SEPARATOR)[0] as FileManagerRoot;
  let path = combinedPath.slice(root.length + ROOT_SEPARATOR.length);
  return { root, path };
};

export const createCombinedPath = (root: string, path: string) => {
  return root + ROOT_SEPARATOR + path;
};

export const baseNameFromPath = (combinedPath: string) => {
  const { root, path } = unpackCombinedPath(combinedPath);

  let baseName = path.endsWith("/")
    ? path.split("/").slice(-2)[0]
    : path.split("/").slice(-1)[0];

  return baseName === "" ? root.slice(1) : baseName;
};

export const deriveParentPath = (path: string) => {
  return path.endsWith("/")
    ? path.split("/").slice(0, -2).join("/") + "/"
    : path.split("/").slice(0, -1).join("/") + "/";
};

export const generateTargetDescription = (path: string) => {
  let parentPath = deriveParentPath(path);
  let nameFromPath = baseNameFromPath(parentPath);

  return (
    <Code>
      {nameFromPath === "project-dir" ? "Project files" : nameFromPath}
    </Code>
  );
};

const getFolderPathOfFile = (path: string) =>
  `${path.split("/").slice(0, -1).join("/")}/`;

export const deduceRenameFromDragOperation = (
  sourcePath: string,
  targetPath: string
): [string, string] => {
  // Check if target is sourceDir or a child of sourceDir
  if (sourcePath === targetPath || targetPath.startsWith(sourcePath)) {
    // Break out with no-op. Illegal move
    return [sourcePath, sourcePath];
  }

  const isSourceDir = sourcePath.endsWith("/");
  const isTargetDir = targetPath.endsWith("/");

  const sourceBasename = baseNameFromPath(sourcePath);
  const targetFolderPath = isTargetDir
    ? targetPath
    : getFolderPathOfFile(targetPath);

  const newPath = `${targetFolderPath}${sourceBasename}${
    isSourceDir ? "/" : ""
  }`;

  return [sourcePath, newPath];
};

/**
 * File API functions
 */

export function isDirectoryEntry(
  entry: FileSystemEntry
): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

export function isFileEntry(
  entry: FileSystemEntry
): entry is FileSystemFileEntry {
  return entry.isFile;
}

export const mergeTrees = (subTree: TreeNode, tree: TreeNode) => {
  // Modifies tree
  // subTree root path
  let { parent } = searchTree(subTree.path, tree);
  for (let x = 0; x < parent.children.length; x++) {
    let child = parent.children[x];
    if (child.path === subTree.path) {
      parent.children[x] = subTree;
      break;
    }
  }
};

export const queryArgs = (obj: Record<string, string | number | boolean>) => {
  return Object.entries(obj).reduce((str, [key, value]) => {
    const leadingCharts = str === "" ? str : `${str}&`;
    return `${leadingCharts}${key}=${window.encodeURIComponent(value)}`;
  }, "");
};

/**
 * Path helpers
 */

export const getActiveRoot = (
  selected: string[],
  treeRoots: FileManagerRoot[]
) => {
  if (selected.length === 0) {
    return treeRoots[0];
  } else {
    const { root } = unpackCombinedPath(selected[0]);
    return root;
  }
};

const isPathChildLess = (path: string, fileTree: TreeNode) => {
  let { node } = searchTree(path, fileTree);
  if (!node) {
    return false;
  } else {
    return node.children.length === 0;
  }
};
export const isCombinedPathChildLess = (
  combinedPath: string,
  fileTrees: FileTrees
) => {
  let { root, path } = unpackCombinedPath(combinedPath);
  return isPathChildLess(path, fileTrees[root]);
};

export const searchTrees = ({
  combinedPath,
  treeRoots,
  fileTrees,
}: {
  combinedPath: string;
  treeRoots: string[];
  fileTrees: Record<string, TreeNode>;
}) => {
  if (treeRoots.includes(combinedPath)) {
    return { node: combinedPath };
  }

  let { root, path } = unpackCombinedPath(combinedPath);
  if (!fileTrees[root]) {
    return {};
  }

  let result = searchTree(path, fileTrees[root]);
  if (result.node !== undefined) {
    return result;
  } else {
    return {};
  }
};

export const cleanFilePath = (filePath: string) =>
  filePath.replace(/^\/project-dir\:\//, "").replace(/^\/data\:\//, "/data/");

/**
 * remove leading "./" of a file path
 * @param filePath string
 * @returns string
 */
export const removeLeadingSymbols = (filePath: string) =>
  filePath.replace(/^\.\//, "");

// user might enter "./foo.ipynb", but it's equivalent to "foo.ipynb".
// this function cleans up the leading "./"
export const getStepFilePath = (step: Step) =>
  removeLeadingSymbols(step.file_path);

export const isFileByExtension = (extensions: string[], filePath: string) => {
  const regex = new RegExp(
    `\.(${extensions
      .map((extension) => extension.replace(/^\./, "")) // in case user add a leading dot
      .join("|")})$`,
    "i"
  );
  return regex.test(filePath);
};

/**
 * This function returns a list of file_path that ends with the given extensions.
 */
export const findFilesByExtension = async ({
  root,
  projectUuid,
  extensions,
  node,
}: {
  root: FileManagerRoot;
  projectUuid: string;
  extensions: string[];
  node: TreeNode;
}) => {
  if (node.type === "file") {
    const isFileType = isFileByExtension(extensions, node.name);
    return isFileType ? [node.name] : [];
  }
  if (node.type === "directory") {
    const response = await fetcher<{ files: string[] }>(
      `/async/file-management/extension-search?${queryArgs({
        project_uuid: projectUuid,
        root,
        path: node.path,
        extensions: extensions.join(","),
      })}`
    );

    return response.files;
  }
};

/**
 * Notebook files cannot be reused in the same pipeline, this function separate Notebook files that are already in use
 * from all the other allowed files
 */
export const validateFiles = (
  currentStepUuid: string | undefined,
  steps: Record<string, Step> | undefined,
  selectedFiles: string[]
) => {
  const allNotebookFileSteps = Object.values(steps || {}).reduce(
    (all, step) => {
      const filePath = getStepFilePath(step);
      if (isFileByExtension(["ipynb"], filePath)) {
        return [...all, { ...step, file_path: filePath }];
      }
      return all;
    },
    [] as Step[]
  );

  return selectedFiles.reduce(
    (all, curr) => {
      const fileExtension = extensionFromFilename(curr);
      const isAllowed = ALLOWED_STEP_EXTENSIONS.some(
        (allowedExtension) =>
          allowedExtension.toLowerCase() === fileExtension.toLowerCase()
      );
      const usedNotebookFiles = allNotebookFileSteps.find((step) => {
        return (
          step.file_path === cleanFilePath(curr) &&
          currentStepUuid !== step.uuid // assigning the same file to the same step is allowed
        );
      });

      return usedNotebookFiles
        ? {
            ...all,
            usedNotebookFiles: [...all.usedNotebookFiles, cleanFilePath(curr)],
          }
        : !isAllowed
        ? { ...all, forbidden: [...all.forbidden, cleanFilePath(curr)] }
        : { ...all, allowed: [...all.allowed, cleanFilePath(curr)] };
    },
    { usedNotebookFiles: [], forbidden: [], allowed: [] }
  );
};

export const allowedExtensionsMarkup = ALLOWED_STEP_EXTENSIONS.map(
  (el, index) => {
    return (
      <span key={el}>
        <Code>.{el}</Code>
        {index < ALLOWED_STEP_EXTENSIONS.length - 1 ? <>&nbsp;, </> : ""}
      </span>
    );
  }
);

export const findFirstDiffIndex = (a: string, b: string) => {
  let i = 0;
  if (a === b) return -1;
  while (a[i] === b[i]) i++;
  return i;
};

export const getRelativePathTo = (filePath: string, targetFolder: string) => {
  const cleanFilePath = filePath.replace(/^\//, "");
  const cleanTargetFolder = targetFolder.replace(/^\//, "");
  const firstDiffIndex = findFirstDiffIndex(cleanFilePath, cleanTargetFolder);

  const upLevels = cleanTargetFolder
    .substring(firstDiffIndex)
    .split("/")
    .filter((value) => value).length;

  const leadingString = "../".repeat(upLevels);

  return `${leadingString}${cleanFilePath.substring(firstDiffIndex)}`;
};

export const filePathFromHTMLElement = (element: HTMLElement) => {
  let dataPath = element.getAttribute("data-path");
  if (dataPath) {
    return dataPath;
  } else if (element.parentElement) {
    return filePathFromHTMLElement(element.parentElement);
  } else {
    return undefined;
  }
};

const dataFolderRegex = /^\/data\:?\//;

export const isWithinDataFolder = (filePath: string) =>
  dataFolderRegex.test(filePath);

const getFilePathInDataFolder = (dragFilePath: string) =>
  cleanFilePath(dragFilePath);

export const getFilePathForDragFile = (
  dragFilePath: string,
  pipelineCwd: string
) => {
  return isWithinDataFolder(dragFilePath)
    ? getFilePathInDataFolder(dragFilePath)
    : getRelativePathTo(cleanFilePath(dragFilePath), pipelineCwd);
};

export const lastSelectedFolderPath = (selectedFiles: string[]) => {
  if (selectedFiles.length === 0) return "/";
  // Note that the selection order in selectedFiles is backward,
  // so we don't need to find from end
  const lastSelected = selectedFiles[0];

  // example:
  // given:     /project-dir:/hello-world/foo/bar.py
  // outcome:   /hello-world/foo/
  const matches = lastSelected.match(/^\/[^\/]+:((\/[^\/]+)*\/)([^\/]*)/);
  return matches ? matches[1] : "/";
};
