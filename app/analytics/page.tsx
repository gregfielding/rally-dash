"use client";

import { useState, useMemo } from "react";
import { useAnalytics } from "@/lib/hooks/useAnalytics";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";

function AnalyticsContent() {
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  
  const filters = useMemo(() => {
    const endDate = new Date();
    let startDate: Date | undefined;
    
    if (dateRange === "7d") {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
    } else if (dateRange === "30d") {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    } else if (dateRange === "90d") {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
    }
    
    return { startDate, endDate };
  }, [dateRange]);

  const { data, error, isLoading } = useAnalytics(filters);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Error loading analytics: {error instanceof Error ? error.message : "Unknown error"}
      </Alert>
    );
  }

  if (!data) {
    return <Alert severity="info">No analytics data available</Alert>;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Analytics Dashboard</Typography>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Date Range</InputLabel>
          <Select value={dateRange} label="Date Range" onChange={(e) => setDateRange(e.target.value as any)}>
            <MenuItem value="7d">Last 7 days</MenuItem>
            <MenuItem value="30d">Last 30 days</MenuItem>
            <MenuItem value="90d">Last 90 days</MenuItem>
            <MenuItem value="all">All time</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Jobs
              </Typography>
              <Typography variant="h4">{data.totalJobs}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Success Rate
              </Typography>
              <Typography variant="h4">{data.successRate.toFixed(1)}%</Typography>
              <Typography variant="body2" color="textSecondary">
                {data.successfulJobs} successful
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Cost
              </Typography>
              <Typography variant="h4">${data.totalCost.toFixed(2)}</Typography>
              <Typography variant="body2" color="textSecondary">
                Est: ${data.totalEstimatedCost.toFixed(2)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Avg Cost/Job
              </Typography>
              <Typography variant="h4">${data.averageCostPerJob.toFixed(4)}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3} mb={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Jobs by Status
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Count</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(data.jobsByStatus).map(([status, count]) => (
                      <TableRow key={status}>
                        <TableCell>{status}</TableCell>
                        <TableCell align="right">{count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Top Products
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Jobs</TableCell>
                      <TableCell align="right">Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.topProducts.map((product) => (
                      <TableRow key={product.productId}>
                        <TableCell>{product.productSlug || product.productId}</TableCell>
                        <TableCell align="right">{product.jobs}</TableCell>
                        <TableCell align="right">${product.cost.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Daily Costs (Last 30 Days)
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Jobs</TableCell>
                  <TableCell align="right">Cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.dailyCosts.slice(-30).map((day) => (
                  <TableRow key={day.date}>
                    <TableCell>{new Date(day.date).toLocaleDateString()}</TableCell>
                    <TableCell align="right">{day.jobs}</TableCell>
                    <TableCell align="right">${day.cost.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function AnalyticsPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <Layout>
        <AnalyticsContent />
      </Layout>
    </ProtectedRoute>
  );
}
