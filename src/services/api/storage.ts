type Job = {
  id: string;
  urls: string[];
  outputType: "audio" | "video";
  outputFormat: string;
  formatId: string | null;
  status: "idle" | "running" | "done" | "error";
  progress: number;
  speed: string | null;
  eta: string | null;
  downloadStatus?: "downloading" | "merging" | "done" | "error";
};

const jobs = new Map<string, Job>();


const createJob = (job: Job) => {
    
    jobs.set(job.id, job);
    return job;
};

const getJob = (jobId: string) => {
    return jobs.get(jobId);
}

const updateJob = (job: Job) => {
    const existingJob = jobs.get(job.id);
    if (existingJob) {
        jobs.set(job.id, job);
        return job;
    } 
};

const deleteJob = (jobId: string) => {
    jobs.delete(jobId);
};

export {
    createJob,
    getJob,
    updateJob,
    deleteJob,
};