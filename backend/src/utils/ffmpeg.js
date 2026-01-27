import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

export const stitchWebmChunks = async (chunkFiles, outputPath) => {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    chunkFiles.forEach(file => {
      command.input(file);
    });

    command
      .on("error", err => reject(err))
      .on("end", () => resolve())
      .mergeToFile(outputPath);
  });
};
