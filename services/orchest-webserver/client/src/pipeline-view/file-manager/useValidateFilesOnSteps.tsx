import { Code } from "@/components/common/Code";
import { useAppContext } from "@/contexts/AppContext";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import React from "react";
import { usePipelineEditorContext } from "../contexts/PipelineEditorContext";
import {
  allowedExtensionsMarkup,
  cleanFilePath,
  validateFiles,
} from "./common";
import { useFileManagerContext } from "./FileManagerContext";

export const useValidateFilesOnSteps = () => {
  const { setAlert } = useAppContext();
  const { pipelineJson } = usePipelineEditorContext();
  const { selectedFiles, dragFile } = useFileManagerContext();

  const filesToProcess = React.useMemo(
    () =>
      selectedFiles.includes(dragFile?.path) ? selectedFiles : [dragFile?.path],
    [selectedFiles, dragFile?.path]
  );

  const getApplicableStepFiles = React.useCallback(
    (stepUuid?: string) => {
      const { usedNotebookFiles, forbidden, allowed } = validateFiles(
        stepUuid,
        pipelineJson?.steps,
        filesToProcess
      );

      if (forbidden.length > 0) {
        setAlert(
          "Warning",
          <Stack spacing={2} direction="column">
            <Box>
              {`Supported file extensions are: `}
              {allowedExtensionsMarkup}
              {`Unable to apply following files to a step:`}
            </Box>
            <ul>
              {forbidden.map((file) => (
                <Box key={file}>
                  <Code>{cleanFilePath(file)}</Code>
                </Box>
              ))}
            </ul>
          </Stack>
        );
      }
      if (usedNotebookFiles.length > 0) {
        setAlert(
          "Warning",
          <Stack spacing={2} direction="column">
            <Box>
              Following Notebook files have already been used in the pipeline.
              Assigning the same Notebook file to multiple steps is not
              supported. Please convert to a script to re-use file across
              pipeline steps.
            </Box>
            <ul>
              {usedNotebookFiles.map((file) => (
                <Box key={file}>
                  <Code>{cleanFilePath(file)}</Code>
                </Box>
              ))}
            </ul>
          </Stack>
        );
      }
      return { usedNotebookFiles, forbidden, allowed };
    },
    [pipelineJson?.steps, filesToProcess, setAlert]
  );

  return getApplicableStepFiles;
};
